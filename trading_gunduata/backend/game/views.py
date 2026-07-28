import random
import math
from decimal import Decimal

from django.contrib.auth import authenticate
from django.utils import timezone
from django.db import transaction as db_transaction

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.authtoken.models import Token

from .models import Wallet, Round, Bet, Transaction
from .serializers import (
    RegisterSerializer, UserSerializer, RoundSerializer,
    BetSerializer, PlaceBetSerializer, TransactionSerializer,
)

COMMISSION = Decimal('0.03')
BETTING_SECONDS = 7
TRADING_SECONDS = 10


# ── Auth ──────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    s = RegisterSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    user = s.save()
    token, _ = Token.objects.get_or_create(user=user)
    return Response({'token': token.key, 'user': UserSerializer(user).data}, status=201)


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    username = request.data.get('username')
    password = request.data.get('password')
    user = authenticate(username=username, password=password)
    if not user:
        return Response({'detail': 'Invalid credentials'}, status=400)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({'token': token.key, 'user': UserSerializer(user).data})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    request.user.auth_token.delete()
    return Response({'detail': 'Logged out'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(UserSerializer(request.user).data)


# ── Wallet ────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def wallet(request):
    w = request.user.wallet
    return Response({'balance': str(w.balance)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def deposit(request):
    amount = Decimal(str(request.data.get('amount', 1000)))
    if amount <= 0:
        return Response({'detail': 'Amount must be positive'}, status=400)
    with db_transaction.atomic():
        w = Wallet.objects.select_for_update().get(user=request.user)
        w.balance += amount
        w.save()
        Transaction.objects.create(
            user=request.user, kind='deposit',
            amount=amount, balance_after=w.balance,
        )
    return Response({'balance': str(w.balance)})


# ── Round ─────────────────────────────────────────────────────────────────────

def _active_round():
    """Return the latest non-settled round, or create a new betting round."""
    rnd = Round.objects.filter(phase__in=['betting', 'trading']).order_by('-id').first()
    if not rnd:
        rnd = _open_new_round()
    return rnd


def _open_new_round():
    now = timezone.now()
    from datetime import timedelta
    rnd = Round.objects.create(
        phase='betting',
        started_at=now,
        phase_ends_at=now + timedelta(seconds=BETTING_SECONDS),
        up_amount=random.randint(12000, 22000),
        down_amount=random.randint(12000, 22000),
        up_players=random.randint(25, 60),
        down_players=random.randint(25, 55),
    )
    return rnd


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def current_round(request):
    rnd = _active_round()
    return Response(RoundSerializer(rnd).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def round_history(request):
    rounds = Round.objects.filter(phase='settled').order_by('-id')[:20]
    return Response(RoundSerializer(rounds, many=True).data)


# ── Betting ───────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def place_bet(request):
    s = PlaceBetSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    side = s.validated_data['side']
    stake = s.validated_data['stake']

    rnd = _active_round()
    if rnd.phase != 'betting':
        return Response({'detail': 'Betting is closed for this round'}, status=400)

    with db_transaction.atomic():
        wallet = Wallet.objects.select_for_update().get(user=request.user)
        if wallet.balance < stake:
            return Response({'detail': 'Insufficient balance'}, status=400)

        existing = Bet.objects.filter(user=request.user, round=rnd).first()
        if existing:
            # Add to existing bet on same side, or flip
            if existing.side == side:
                existing.stake += stake
                existing.save()
            else:
                existing.side = side
                existing.save()
            bet = existing
        else:
            bet = Bet.objects.create(user=request.user, round=rnd, side=side, stake=stake)

        wallet.balance -= stake
        wallet.save()
        Transaction.objects.create(
            user=request.user, kind='bet', amount=-stake,
            balance_after=wallet.balance, round=rnd,
            note=f'{side.upper()} ₹{stake}',
        )

    return Response(BetSerializer(bet).data, status=201)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def cashout(request):
    """Cash out mid-round during trading phase (3% fee)."""
    rnd = _active_round()
    if rnd.phase != 'trading':
        return Response({'detail': 'Cashout only during trading phase'}, status=400)

    bet = Bet.objects.filter(user=request.user, round=rnd, cashed_out=False).first()
    if not bet:
        return Response({'detail': 'No active bet to cash out'}, status=400)

    live_pct = float(request.data.get('live_pct', 0))
    aligned = live_pct if bet.side == 'up' else -live_pct
    raw = float(bet.stake) * (1 + aligned / 100)
    raw = max(0, min(raw, float(bet.stake) * 2))
    payout = Decimal(str(round(raw * (1 - float(COMMISSION)), 2)))

    with db_transaction.atomic():
        wallet = Wallet.objects.select_for_update().get(user=request.user)
        wallet.balance += payout
        wallet.save()
        bet.cashed_out = True
        bet.cashout_pct = live_pct
        bet.cashout_payout = payout
        bet.save()
        Transaction.objects.create(
            user=request.user, kind='cashout', amount=payout,
            balance_after=wallet.balance, round=rnd,
            note=f'Cashout at {live_pct:.1f}%',
        )

    return Response({'payout': str(payout), 'balance': str(wallet.balance)})


# ── Settlement (called by the game loop / admin) ───────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def settle_round(request):
    """Settle the current trading round. Supply final_pct in body."""
    if not request.user.is_staff:
        return Response({'detail': 'Staff only'}, status=403)

    final_pct = float(request.data.get('final_pct', 0))
    rnd = Round.objects.filter(phase='trading').order_by('-id').first()
    if not rnd:
        return Response({'detail': 'No active trading round'}, status=400)

    with db_transaction.atomic():
        rnd.final_pct = final_pct
        rnd.phase = 'settled'
        rnd.settled_at = timezone.now()
        rnd.save()

        bets = Bet.objects.filter(round=rnd, cashed_out=False, won__isnull=True)
        for bet in bets:
            aligned = final_pct if bet.side == 'up' else -final_pct
            raw = float(bet.stake) * (1 + aligned / 100)
            raw = max(0, min(raw, float(bet.stake) * 2))
            won = aligned > 0
            payout = Decimal(str(round(raw, 2)))
            bet.payout = payout
            bet.won = won
            bet.save()

            wallet = Wallet.objects.select_for_update().get(user=bet.user)
            wallet.balance += payout
            wallet.save()
            Transaction.objects.create(
                user=bet.user,
                kind='win' if won else 'loss',
                amount=payout,
                balance_after=wallet.balance,
                round=rnd,
                note=f'{"WIN" if won else "LOSS"} {final_pct:+.1f}%',
            )

    return Response(RoundSerializer(rnd).data)


# ── My bets & transactions ─────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_bets(request):
    bets = Bet.objects.filter(user=request.user).order_by('-placed_at')[:50]
    return Response(BetSerializer(bets, many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_transactions(request):
    txns = Transaction.objects.filter(user=request.user).order_by('-created_at')[:100]
    return Response(TransactionSerializer(txns, many=True).data)


# ── Round leaderboard ─────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def leaderboard(request):
    from django.db.models import Sum, Count
    data = (
        Wallet.objects.select_related('user')
        .order_by('-balance')[:20]
        .values('user__username', 'balance')
    )
    return Response(list(data))

"""
Colour game timer — runs one 60-second round continuously.
  0-30s  : BETTING open
  30-60s : BETTING closed (CLOSED)
  At 60s : pick result, settle bets, start new round
"""
import logging
import time
import random

from django.core.management.base import BaseCommand
from django.utils import timezone
from django.db import transaction as db_transaction

logger = logging.getLogger('game.colour_timer')

ROUND_DURATION   = 60
BETTING_CLOSE_AT = 30

COLOUR_RATIOS = {
    'red':    1.9,
    'green':  1.9,
    'violet': 4.5,
    'number': {
        0: 8.0,
        5: 8.0,
        **{n: 5.0 for n in range(1, 10) if n != 5},
    }
}


def _pick_colour_result():
    result = random.choice(['red', 'green', 'red_violet', 'green_violet'])
    if result == 'green_violet':
        number = 5
    elif result == 'red_violet':
        number = 0
    elif result == 'green':
        number = random.choice([1, 3, 7, 9])
    else:
        number = random.choice([2, 4, 6, 8])
    return result, number


def _settle_colour_bet(bet_on, bet_number, result, result_number):
    colours_in_result = result.split('_')
    if bet_on == 'number':
        if bet_number == result_number:
            return COLOUR_RATIOS['number'].get(bet_number, 5.0)
        return 0
    if bet_on in colours_in_result:
        return COLOUR_RATIOS[bet_on]
    return 0


def _settle_round(round_obj):
    """Settle all pending bets for a completed colour round."""
    from game.models import ColourBet
    from accounts.models import Wallet, Transaction as Txn

    bets = ColourBet.objects.filter(round=round_obj, status='PENDING').select_related('user')
    now  = timezone.now()

    for bet in bets:
        ratio  = _settle_colour_bet(bet.bet_on, bet.number, round_obj.result, round_obj.number)
        won    = ratio > 0
        payout = int(bet.amount * ratio) if won else 0

        try:
            with db_transaction.atomic():
                wallet = Wallet.objects.select_for_update().get(user=bet.user)
                balance_before = wallet.balance

                if won:
                    wallet.balance += payout
                    wallet.save(update_fields=['balance', 'updated_at'])
                    Txn.objects.create(
                        user=bet.user,
                        transaction_type='WIN',
                        amount=payout,
                        balance_before=balance_before,
                        balance_after=wallet.balance,
                        description=f'Colour game WIN: round {round_obj.round_id}, {bet.bet_on}, payout {payout}',
                    )

                bet.status     = 'WON' if won else 'LOST'
                bet.payout     = payout
                bet.settled_at = now
                bet.save(update_fields=['status', 'payout', 'settled_at'])

        except Exception as e:
            logger.error(f"Failed to settle colour bet {bet.id}: {e}", exc_info=True)


class Command(BaseCommand):
    help = 'Runs the colour game timer (60s rounds)'

    def handle(self, *args, **options):
        from game.models import ColourRound

        self.stdout.write(self.style.SUCCESS('Colour game timer started'))

        while True:
            try:
                now = timezone.now()

                round_obj = ColourRound.objects.filter(
                    status__in=['BETTING', 'CLOSED']
                ).order_by('-start_time').first()

                if not round_obj:
                    START_NUMBER = 189745676
                    last = ColourRound.objects.order_by('-id').first()
                    if last and last.round_id.startswith('R'):
                        try:
                            next_num = int(last.round_id[1:]) + 1
                        except ValueError:
                            next_num = START_NUMBER
                    else:
                        next_num = START_NUMBER
                    new_round_id = f"R{next_num}"

                    round_obj = ColourRound.objects.create(
                        round_id=new_round_id,
                        status='BETTING',
                    )
                    self.stdout.write(self.style.SUCCESS(f'New colour round: {round_obj.round_id}'))

                elapsed = (now - round_obj.start_time).total_seconds()

                if elapsed >= BETTING_CLOSE_AT and round_obj.status == 'BETTING':
                    round_obj.status     = 'CLOSED'
                    round_obj.close_time = now
                    round_obj.save(update_fields=['status', 'close_time'])
                    self.stdout.write(self.style.WARNING(f'Round {round_obj.round_id} CLOSED at {elapsed:.1f}s'))

                if elapsed >= ROUND_DURATION and round_obj.status == 'CLOSED':
                    result, number = _pick_colour_result()

                    round_obj.result      = result
                    round_obj.number      = number
                    round_obj.status      = 'RESULT'
                    round_obj.result_time = now
                    round_obj.save(update_fields=['result', 'number', 'status', 'result_time'])

                    self.stdout.write(self.style.SUCCESS(
                        f'Round {round_obj.round_id} RESULT: {result} / {number}'
                    ))

                    _settle_round(round_obj)

                    round_obj.status   = 'COMPLETED'
                    round_obj.end_time = timezone.now()
                    round_obj.save(update_fields=['status', 'end_time'])

                    self.stdout.write(self.style.SUCCESS(f'Round {round_obj.round_id} COMPLETED'))

                time.sleep(1)

            except Exception as e:
                logger.error(f"Colour game timer error: {e}", exc_info=True)
                self.stdout.write(self.style.ERROR(f'Error: {e}'))
                time.sleep(2)

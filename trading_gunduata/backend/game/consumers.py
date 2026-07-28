"""
WebSocket consumer — broadcasts live round state to all connected clients.
Connect:  ws://localhost:8000/ws/round/
Frontend receives JSON messages:
  { type: "round_state", round: {...}, ms_left: 4200 }
  { type: "tick", live_pct: 12.4, ms_left: 3100 }
"""
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone

ROUND_GROUP = 'round_live'


class RoundConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.channel_layer.group_add(ROUND_GROUP, self.channel_name)
        await self.accept()
        # Send current round state immediately on connect
        state = await self._get_round_state()
        await self.send(text_data=json.dumps({'type': 'round_state', **state}))

    async def disconnect(self, code):
        await self.channel_layer.group_discard(ROUND_GROUP, self.channel_name)

    async def receive(self, text_data):
        pass  # clients are read-only for now

    # ── Group message handlers ──────────────────────────────────────────────

    async def round_state(self, event):
        await self.send(text_data=json.dumps(event))

    async def round_tick(self, event):
        await self.send(text_data=json.dumps(event))

    # ── Helpers ─────────────────────────────────────────────────────────────

    @database_sync_to_async
    def _get_round_state(self):
        from .models import Round
        from .serializers import RoundSerializer
        rnd = Round.objects.filter(phase__in=['betting', 'trading']).order_by('-id').first()
        if not rnd:
            return {'round': None, 'ms_left': 0}
        ms_left = max(0, int((rnd.phase_ends_at - timezone.now()).total_seconds() * 1000)) if rnd.phase_ends_at else 0
        return {'round': RoundSerializer(rnd).data, 'ms_left': ms_left}

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Player
from game.models import PendingBet, Round


class ApiFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _session(self):
        res = self.client.post("/api/session/")
        self.assertEqual(res.status_code, 201)
        token = res.data["session_token"]
        self.client.credentials(HTTP_X_SESSION_TOKEN=token)
        return res.data

    def test_session_starts_with_10000(self):
        data = self._session()
        self.assertEqual(data["balance"], 10_000)
        self.assertEqual(data["pending_bets"], [])

    def test_place_undo_double_clear(self):
        self._session()
        r = self.client.post("/api/bets/", {"key": "straight:17", "amount": 10}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["balance"], 9_990)
        self.assertEqual(r.data["total_bet"], 10)

        r = self.client.post("/api/bets/undo/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["balance"], 10_000)
        self.assertEqual(r.data["total_bet"], 0)

        self.client.post("/api/bets/", {"type": "red", "amount": 50}, format="json")
        r = self.client.post("/api/bets/double/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["balance"], 9_900)
        self.assertEqual(r.data["total_bet"], 100)

        r = self.client.post("/api/bets/clear/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["balance"], 10_000)
        self.assertEqual(r.data["total_bet"], 0)

    def test_spin_settles_straight(self):
        self._session()
        self.client.post("/api/bets/", {"key": "straight:7", "amount": 10}, format="json")
        r = self.client.post("/api/spin/", {"number": 7}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["number"], 7)
        self.assertEqual(r.data["win"], 360)
        # 10000 - 10 + 360
        self.assertEqual(r.data["balance"], 10_350)
        self.assertEqual(r.data["winning_keys"], ["straight:7"])
        self.assertEqual(PendingBet.objects.count(), 0)
        self.assertEqual(Round.objects.count(), 1)

    def test_spin_requires_bets(self):
        self._session()
        r = self.client.post("/api/spin/", {}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_me_and_history(self):
        self._session()
        self.client.post("/api/bets/", {"key": "straight:0", "amount": 10}, format="json")
        self.client.post("/api/spin/", {"number": 0}, format="json")
        me = self.client.get("/api/me/")
        self.assertEqual(me.status_code, 200)
        hist = self.client.get("/api/history/")
        self.assertEqual(hist.status_code, 200)
        self.assertEqual(len(hist.data["results"]), 1)
        self.assertEqual(hist.data["results"][0]["number"], 0)

    def test_missing_token(self):
        r = self.client.get("/api/me/")
        self.assertEqual(r.status_code, 401)

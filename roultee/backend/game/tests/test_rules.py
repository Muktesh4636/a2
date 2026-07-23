from django.test import TestCase

from game.rules import BetKey, hits, payout_odds, settle_amount


class RulesTests(TestCase):
    def test_straight_hit(self):
        key = BetKey("straight", "17")
        self.assertTrue(hits(key, 17))
        self.assertFalse(hits(key, 18))
        self.assertEqual(payout_odds(key), 36)
        self.assertEqual(settle_amount(key, 10, 17), 360)

    def test_zero_kills_even_money(self):
        self.assertFalse(hits(BetKey("red"), 0))
        self.assertFalse(hits(BetKey("even"), 0))
        self.assertFalse(hits(BetKey("low"), 0))
        self.assertTrue(hits(BetKey("straight", "0"), 0))

    def test_color_and_parity(self):
        self.assertTrue(hits(BetKey("red"), 1))
        self.assertTrue(hits(BetKey("black"), 2))
        self.assertTrue(hits(BetKey("even"), 2))
        self.assertTrue(hits(BetKey("odd"), 3))
        self.assertEqual(payout_odds(BetKey("red")), 2)

    def test_dozen_column(self):
        self.assertTrue(hits(BetKey("dozen", "1"), 12))
        self.assertTrue(hits(BetKey("dozen", "2"), 13))
        self.assertTrue(hits(BetKey("dozen", "3"), 36))
        self.assertTrue(hits(BetKey("column", "1"), 1))
        self.assertTrue(hits(BetKey("column", "2"), 2))
        self.assertTrue(hits(BetKey("column", "3"), 3))
        self.assertEqual(payout_odds(BetKey("dozen", "1")), 3)
        self.assertEqual(settle_amount(BetKey("column", "1"), 100, 1), 300)

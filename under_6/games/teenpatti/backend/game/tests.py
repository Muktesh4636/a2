from django.test import SimpleTestCase

from game.services import Card, compare_hands, dealer_qualifies, evaluate_hand


def C(label, symbol="♠", red=False):
    from game.services import RANK_VALUE

    return Card(label=label, value=RANK_VALUE[label], symbol=symbol, red=red)


class HandRankingTests(SimpleTestCase):
    def test_trail_beats_pure_sequence(self):
        trail, _ = evaluate_hand([C("A"), C("A", "♥", True), C("A", "♦", True)])
        pure, _ = evaluate_hand([C("A"), C("K"), C("Q")])
        self.assertGreater(trail, pure)

    def test_wheel_is_sequence(self):
        key, name = evaluate_hand([C("A"), C("2", "♥", True), C("3", "♦", True)])
        self.assertEqual(name, "sequence")
        akq, _ = evaluate_hand([C("A"), C("K", "♥", True), C("Q", "♦", True)])
        self.assertGreater(akq, key)

    def test_dealer_queen_high_qualifies(self):
        q_high, _ = evaluate_hand([C("Q"), C("9", "♥", True), C("2", "♦", True)])
        j_high, _ = evaluate_hand([C("J"), C("9", "♥", True), C("2", "♦", True)])
        self.assertTrue(dealer_qualifies(q_high))
        self.assertFalse(dealer_qualifies(j_high))

    def test_pair_beats_high(self):
        pair, _ = evaluate_hand([C("2"), C("2", "♥", True), C("K", "♦", True)])
        high, name = evaluate_hand([C("A"), C("K", "♥", True), C("J", "♦", True)])
        self.assertEqual(name, "high")
        self.assertEqual(compare_hands(pair, high), "player")

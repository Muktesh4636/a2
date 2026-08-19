/**
 * Bottom betting controls
 * Cash Out, Part Payout, bet +/- , Spin, AUTO
 */
const $ = (id) => document.getElementById(id);

export function createControls(handlers) {
  const {
    getBet,
    setBet,
    isBusy,
    onSpin,
    onCashOut,
    onPart,
    onAutoToggle,
  } = handlers;

  $("betMinus").onclick = () => {
    if (isBusy()) return;
    setBet(Math.max(1, getBet() - 5));
  };

  $("betPlus").onclick = () => {
    if (isBusy()) return;
    setBet(Math.min(500, getBet() + 5));
  };

  $("cashoutBtn").onclick = () => onCashOut(false);
  $("partBtn").onclick = () => onPart();
  $("spinBtn").onclick = () => onSpin();
  $("autoBtn").onclick = () => onAutoToggle();

  return {
    update({
      bet,
      payoutText,
      partText,
      hasProgress,
      canPart,
      busy,
      auto,
    }) {
      $("betValue").textContent = String(bet);
      $("payoutValue").textContent = payoutText;
      $("partValue").textContent = partText;

      $("cashoutBtn").disabled = !hasProgress || busy;
      $("cashoutBtn").classList.toggle("is-live", hasProgress && !busy);
      $("partBtn").disabled = !canPart || busy;

      $("spinBtn").disabled = busy;
      $("spinBtn").classList.toggle("spinning", busy);
      $("autoBtn").classList.toggle("on", !!auto);
    },

    setSpinning(on) {
      $("spinBtn").classList.toggle("spinning", on);
      $("spinBtn").disabled = on;
    },
  };
}

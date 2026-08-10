/**
 * Shared live members (left) + live wins (right) for casino mini-games.
 */
(function () {
  if (window.__gunduLiveWinsStarted) return;
  window.__gunduLiveWinsStarted = true;

  const PLAYERS = [
    { user: "WorthOtter45", flag: "ca" },
    { user: "29545666--7b", flag: "in" },
    { user: "LuckyFox99", flag: "us" },
    { user: "ProGamer22", flag: "br" },
    { user: "egg***88", flag: "in" },
    { user: "Kimmstarr", flag: "nl" },
    { user: "62NiftyStint", flag: "gb" },
    { user: "26286699--27e", flag: "in" },
    { user: "RajaWin***", flag: "in" },
    { user: "NightOwl_7", flag: "de" },
    { user: "SpinKing21", flag: "ph" },
    { user: "mystic***9", flag: "us" },
    { user: "ApexHunter", flag: "au" },
    { user: "bet***404", flag: "ng" },
    { user: "GoldenEgg88", flag: "in" },
    { user: "FoxTrail12", flag: "ca" },
    { user: "lucky***x", flag: "bd" },
    { user: "TurboDash", flag: "br" },
    { user: "neon_piper", flag: "jp" },
    { user: "CashCow99", flag: "za" },
    { user: "7b--884512", flag: "in" },
    { user: "SkyRocket", flag: "mx" },
    { user: "play***77", flag: "pk" },
    { user: "NovaBlast", flag: "fr" },
    { user: "PlinkKing", flag: "in" },
    { user: "drop***42", flag: "us" },
  ];

  const COLORS = [
    "#c0392b",
    "#2980b9",
    "#27ae60",
    "#8e44ad",
    "#d35400",
    "#16a085",
    "#c0398b",
    "#2c3e50",
    "#e67e22",
    "#1abc9c",
  ];

  let online = 1200 + Math.floor(Math.random() * 400);
  let lastUser = "";

  function randomAmount() {
    const roll = Math.random();
    if (roll < 0.55) return +(Math.random() * 80 + 5).toFixed(2);
    if (roll < 0.85) return +(Math.random() * 400 + 80).toFixed(2);
    return +(Math.random() * 2000 + 400).toFixed(2);
  }

  function nextWin() {
    let u = PLAYERS[Math.floor(Math.random() * PLAYERS.length)];
    for (let i = 0; i < 6 && u.user === lastUser; i++) {
      u = PLAYERS[Math.floor(Math.random() * PLAYERS.length)];
    }
    lastUser = u.user;
    const letter = (u.user.replace(/[^a-zA-Z]/g, "")[0] || "P").toUpperCase();
    return {
      ...u,
      letter,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      amount: randomAmount(),
    };
  }

  function ensureDom() {
    let members = document.getElementById("gundu-live-members");
    if (!members) {
      members = document.createElement("div");
      members.id = "gundu-live-members";
      members.className = "gundu-live-members";
      members.innerHTML =
        '<div class="gundu-live-members__pill">' +
        '<span class="gundu-live-members__dot" aria-hidden="true"></span>' +
        '<span class="gundu-live-members__online">' +
        online.toLocaleString("en-IN") +
        "</span>" +
        "</div>";
      document.body.appendChild(members);
    }

    let wins = document.getElementById("gundu-live-wins");
    if (!wins) {
      wins = document.createElement("div");
      wins.id = "gundu-live-wins";
      wins.className = "gundu-live-wins";
      wins.setAttribute("aria-live", "polite");
      wins.innerHTML = '<div class="gundu-live-wins__entry"></div>';
      document.body.appendChild(wins);
    }

    return { members: members, wins: wins };
  }

  function render(entry) {
    const dom = ensureDom();
    const entryEl = dom.wins.querySelector(".gundu-live-wins__entry");
    const onlineEl = dom.members.querySelector(".gundu-live-members__online");
    if (!entryEl) return;

    const amt = Math.round(entry.amount).toLocaleString("en-IN");
    entryEl.innerHTML =
      '<div class="gundu-live-wins__avatar" style="background:' +
      entry.color +
      '">' +
      entry.letter +
      "</div>" +
      '<img class="gundu-live-wins__flag" src="https://flagcdn.com/w40/' +
      entry.flag +
      '.png" alt="" />' +
      '<span class="gundu-live-wins__user">' +
      entry.user +
      "</span>" +
      '<span class="gundu-live-wins__amt">+₹' +
      amt +
      "</span>";

    entryEl.classList.remove("is-fresh");
    void entryEl.offsetWidth;
    entryEl.classList.add("is-fresh");

    online = Math.max(900, online + Math.floor(Math.random() * 9 - 4));
    if (onlineEl) onlineEl.textContent = online.toLocaleString("en-IN");
  }

  function start() {
    ensureDom();
    render(nextWin());
    setInterval(function () {
      render(nextWin());
    }, 2800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

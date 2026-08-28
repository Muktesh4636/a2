/**
 * Casino Games list — all tiles link to web games (APK WebView + browser).
 *
 * Flow (no APK update for new games):
 * 1. App Play → loads website /casino/ once
 * 2. Tap a tile → AndroidBridge.openGame(id, fullUrl) opens that game path
 * 3. Never reload casino when opening a game from the lobby
 *
 * To add a game:
 * 1. Put the tile image in ./images/
 * 2. Append { id, title, image, path } below
 * 3. Redeploy casino (+ host the game under path)
 */
export const GAMES = [
  {
    id: "gundu-ata",
    title: "Gundu Ata",
    image: "images/gundu-ata.png",
    path: "/game/?v=44",
  },
  {
    id: "horse-racing",
    title: "Horse Race",
    image: "images/horse-racing.jpeg?v=1",
    path: "/horse-racing/",
  },
  {
    id: "stock-market",
    title: "Stock Market",
    image: "images/stock-market.png",
    path: "/trading/",
  },
  {
    id: "live-roulette",
    title: "Live Roulette",
    image: "images/auto-roulette.png",
    path: "/roulette/",
  },
  {
    id: "chicken-road",
    title: "Chicken Road",
    image: "images/chicken-road.png",
    path: "/chicken-road/",
  },
  {
    id: "chicken-road-2",
    title: "Chicken Road 2",
    image: "images/chicken-road-2.png",
    path: "/chicken-road-2/",
  },
  {
    id: "vortex",
    title: "Vortex",
    image: "images/vortex.png",
    path: "/vortex/",
  },
  {
    id: "vortex-1",
    title: "Vortex 1",
    image: "images/vortex-1.png",
    path: "/vortex-1/",
  },
  {
    id: "vip-vortex",
    title: "VIP Vortex",
    image: "images/vip-vortex.png",
    path: "/vip-vortex/",
  },
  {
    id: "plinko",
    title: "Plinko",
    image: "images/plinko.jpeg",
    path: "/plinko/",
  },
  {
    id: "slide",
    title: "Pin Stop",
    image: "images/slide.jpeg",
    path: "/slide/",
  },
  {
    id: "chit-pat",
    title: "Chit Pat",
    image: "images/chit-pat.png",
    path: "/chit-pat/",
  },
  {
    id: "rangu",
    title: "Rangu",
    image: "images/rangu.png",
    path: "/rangu/",
  },
  {
    id: "mines",
    title: "Mines",
    image: "images/mines.jpeg",
    path: "/mines/",
  },
  {
    id: "steps",
    title: "Sky Path",
    image: "images/steps.jpeg",
    path: "/steps/",
  },
  {
    id: "boxes",
    title: "Pick 4",
    image: "images/boxes.jpeg",
    path: "/boxes/",
  },
  {
    id: "snake",
    title: "Roll & Land",
    image: "images/snake.jpeg",
    path: "/snake/",
  },
  {
    id: "cases",
    title: "Vault",
    image: "images/cases.jpeg",
    path: "/cases/",
  },
  {
    id: "air-balloon",
    title: "Air Balloon",
    image: "images/air-balloon.jpeg",
    path: "/air-balloon/",
  },
  {
    id: "circle-game",
    title: "Circle Bet",
    image: "images/circle-game.jpeg",
    path: "/circle-game/",
  },
  {
    id: "stop-bar",
    title: "Stop Bar",
    image: "images/stop-bar.jpeg",
    path: "/stop-bar/",
  },
  {
    id: "spin-dial",
    title: "Spin Dial",
    image: "images/spin-dial.jpeg",
    path: "/spin-dial/",
  },
  {
    id: "mines-path",
    title: "Mines Path",
    image: "images/mines-path.jpeg",
    path: "/mines-path/",
  },
  {
    id: "dice-over-under",
    title: "Dice Over Under",
    image: "images/dice-over-under.jpeg",
    path: "/dice-over-under/",
  },
  {
    id: "color-match",
    title: "Color Match",
    image: "images/color-match.jpeg",
    path: "/color-match/",
  },
  {
    id: "wheel-pockets",
    title: "Wheel Pockets",
    image: "images/wheel-pockets.jpeg",
    path: "/wheel-pockets/",
  },
  {
    id: "wave-surf",
    title: "Wave Surf",
    image: "images/wave-surf.jpeg",
    path: "/wave-surf/",
  },
  {
    id: "keno-pick",
    title: "Keno Pick",
    image: "images/keno-pick.jpeg",
    path: "/keno-pick/",
  },
  {
    id: "hi-lo-cards",
    title: "Hi-Lo Cards",
    image: "images/hi-lo-cards.jpeg",
    path: "/hi-lo-cards/",
  },
  {
    id: "aviator",
    title: "Aviator",
    image: "images/aviator.png",
    path: "/aviator/",
  },
  {
    id: "jet",
    title: "Jet",
    image: "images/jet.png",
    path: "/jet/",
  },
  {
    id: "maestro",
    title: "Maestro",
    image: "images/maestro.png",
    path: "/maestro/",
  },
  {
    id: "deep-dive",
    title: "Deep Dive",
    image: "images/deep-dive.png",
    path: "/deep-dive/",
  },
  {
    id: "sky-lift",
    title: "Sky Lift",
    image: "images/sky-lift.png",
    path: "/sky-lift/",
  },
  {
    id: "paper-plane",
    title: "Paper Plane",
    image: "images/paper-plane.png",
    path: "/paper-plane/",
  },
  {
    id: "ufo-lift",
    title: "UFO Lift",
    image: "images/ufo-lift.png",
    path: "/ufo-lift/",
  },
  {
    id: "shark-bite",
    title: "Shark Bite",
    image: "images/shark-bite.png",
    path: "/shark-bite/",
  },
  {
    id: "under-6",
    title: "Under 6",
    image: "images/under-6.jpeg",
    path: "/under-6/",
  },
  {
    id: "rushbet",
    title: "Rush Bet",
    image: "images/rushbet.jpeg?v=2",
    path: "/rushbet/",
  },
  {
    id: "knock6",
    title: "Knock 6",
    image: "images/knock6.jpeg?v=3",
    path: "/knock6/",
  },
  {
    id: "tripleedge",
    title: "Triple Edge",
    image: "images/tripleedge.jpeg?v=2",
    path: "/tripleedge/",
  },
  {
    id: "mirror",
    title: "Mirror",
    image: "images/mirror.jpeg?v=2",
    path: "/mirror/",
  },
  {
    id: "goldlane",
    title: "Gold Lane",
    image: "images/goldlane.jpeg?v=2",
    path: "/goldlane/",
  },
  {
    id: "dead7",
    title: "Dead 7",
    image: "images/dead7.jpeg?v=3",
    path: "/dead7/",
  },
  {
    id: "teenpatti",
    title: "Teen Patti",
    image: "images/teenpatti.jpeg?v=2",
    path: "/teenpatti/",
  },
];

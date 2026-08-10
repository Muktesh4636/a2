/**
 * Casino Games list — all tiles link to web games (APK WebView + browser).
 *
 * To add a game:
 * 1. Put the tile image in ./images/
 * 2. Append an object below with id, title, image, path
 * 3. Redeploy — APK openGame uses the same id → path map
 *
 * path: web URL on gunduata.tech (?token= is appended automatically)
 */
export const GAMES = [
  {
    id: "gundu-ata",
    title: "Gundu Ata",
    image: "images/gundu-ata.png",
    path: "/game/?v=8",
  },
  {
    id: "stock-market",
    title: "Stock Market",
    image: "images/stock-market.png",
    path: "/trading/",
  },
  {
    id: "auto-roulette",
    title: "Auto Roulette",
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
];

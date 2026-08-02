/**
 * Casino Games list — all tiles link to web games.
 *
 * To add a game:
 * 1. Put the tile PNG in ./images/ (e.g. images/my-game.png)
 * 2. Append an object below with id, title, image, path
 * 3. Redeploy — no other code changes needed
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
];

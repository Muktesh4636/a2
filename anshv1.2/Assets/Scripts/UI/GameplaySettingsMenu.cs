using System.Collections.Generic;
using System.Text;
using DG.Tweening;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Settings sheet matching chosen design:
/// milky white rounded card + gold border, 3 large icons side-by-side.
/// White sheet only on the card — rest of screen stays clear.
/// </summary>
public class GameplaySettingsMenu : MonoBehaviour
{
    [Header("Optional overrides")]
    public Sprite gearSprite;
    public RectTransform bottomBar;

    private GameObject overlayRoot;
    private GameObject menuCard;
    private GameObject panelRoot;
    private Image panelIcon;
    private TextMeshProUGUI panelTitle;
    private TextMeshProUGUI panelBody;
    private bool menuOpen;
    private bool built;

    private Sprite iconBet;
    private Sprite iconRules;
    private Sprite iconResults;
    private Sprite panelSheet;
    private Sprite iconHighlight;

    private readonly List<RectTransform> optionCells = new List<RectTransform>();
    private readonly List<Image> optionGlows = new List<Image>();
    private readonly List<TextMeshProUGUI> optionLabels = new List<TextMeshProUGUI>();
    private Sequence highlightSeq;

    private static readonly Color Gold = new Color(0.78f, 0.62f, 0.18f, 1f);
    private static readonly Color MilkWhite = new Color(1f, 1f, 1f, 0.82f);
    private static readonly Color LabelDark = new Color(0.22f, 0.20f, 0.18f, 1f);
    private static readonly Color Divider = new Color(0.75f, 0.70f, 0.55f, 0.45f);
    // Soft dim so the game behind doesn't dominate; icons stay the focus
    private static readonly Color BackdropDim = new Color(0.02f, 0.05f, 0.04f, 0.55f);

    private const string RulesText =
        "GUNDU ATA — GAME RULES\n\n" +
        "1. Place bets on numbers 1–6 during PLACE YOUR BETS.\n" +
        "2. Betting closes before the dice roll.\n" +
        "3. Three dice are rolled; the winning number is the result.\n" +
        "4. Matching bets are paid according to payout settings.\n" +
        "5. You can undo your last bet while betting is open.\n" +
        "6. Exposure shows your open stake for the current round.\n\n" +
        "Play responsibly.";

    public void Build()
    {
        if (built) return;
        built = true;

        if (bottomBar == null)
        {
            var bottom = transform.Find("Bottom") ?? FindDeepChild(transform, "Bottom");
            if (bottom != null) bottomBar = bottom as RectTransform;
        }

        iconBet = Resources.Load<Sprite>("UI/icon_bet_history");
        iconRules = Resources.Load<Sprite>("UI/icon_game_rules");
        iconResults = Resources.Load<Sprite>("UI/icon_recent_results");
        panelSheet = Resources.Load<Sprite>("UI/settings_panel_sheet");
        iconHighlight = Resources.Load<Sprite>("UI/settings_icon_highlight");

        RectTransform host = bottomBar != null ? bottomBar : transform as RectTransform;
        CreateGearButton(host);
        CreateOverlay(transform as RectTransform);
        CloseAll();
    }

    private void CreateGearButton(RectTransform host)
    {
        var go = new GameObject("SettingsGearBtn", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image), typeof(Button));
        var rt = go.GetComponent<RectTransform>();
        rt.SetParent(host, false);
        rt.anchorMin = new Vector2(1f, 0.5f);
        rt.anchorMax = new Vector2(1f, 0.5f);
        rt.pivot = new Vector2(1f, 0.5f);
        rt.sizeDelta = new Vector2(78f, 78f);
        rt.anchoredPosition = new Vector2(-8f, 0f);

        var img = go.GetComponent<Image>();
        img.preserveAspect = true;
        img.color = Color.white;
        Sprite spr = gearSprite != null ? gearSprite : Resources.Load<Sprite>("UI/settings_gear");
        if (spr != null) img.sprite = spr;
        else img.color = Gold;

        var btn = go.GetComponent<Button>();
        btn.targetGraphic = img;
        btn.onClick.AddListener(ToggleMenu);
    }

    private void CreateOverlay(RectTransform root)
    {
        overlayRoot = new GameObject("SettingsOverlay", typeof(RectTransform));
        var ort = overlayRoot.GetComponent<RectTransform>();
        ort.SetParent(root, false);
        Stretch(ort);
        ort.SetAsLastSibling();

        // Soft dim behind settings so the three icons read as focused
        // (no heavy blur — just enough that the game doesn't dominate)
        var catcherGo = CreateUi("OutsideTapCatcher", overlayRoot.transform);
        var catchRt = catcherGo.GetComponent<RectTransform>();
        Stretch(catchRt);
        var catchImg = catcherGo.AddComponent<Image>();
        catchImg.color = BackdropDim;
        var catchBtn = catcherGo.AddComponent<Button>();
        catchBtn.targetGraphic = catchImg;
        catchBtn.transition = Selectable.Transition.None;
        catchBtn.onClick.AddListener(CloseAll);

        // Milky white sheet card only (matches chosen design)
        menuCard = CreateUi("SettingsMenuCard", overlayRoot.transform);
        var mrt = menuCard.GetComponent<RectTransform>();
        mrt.anchorMin = mrt.anchorMax = new Vector2(0.5f, 0.5f);
        mrt.pivot = new Vector2(0.5f, 0.5f);
        mrt.sizeDelta = new Vector2(820f, 340f);
        mrt.anchoredPosition = new Vector2(0f, 40f);

        var mimg = menuCard.AddComponent<Image>();
        if (panelSheet != null)
        {
            mimg.sprite = panelSheet;
            mimg.type = Image.Type.Sliced;
            mimg.pixelsPerUnitMultiplier = 1.15f;
            mimg.color = new Color(1f, 1f, 1f, 0.98f); // more opaque so icons pop
        }
        else
        {
            mimg.color = new Color(1f, 1f, 1f, 0.95f);
        }
        mimg.raycastTarget = true;
        // No Outline — sharp Outline fights rounded corners; gold edge is in the sliced sprite

        var block = menuCard.AddComponent<Button>();
        block.targetGraphic = mimg;
        block.transition = Selectable.Transition.None;

        // 3 equal columns side-by-side
        string[] labels = { "Bet History", "Game Rules", "Recent Results" };
        Sprite[] icons = { iconBet, iconRules, iconResults };
        optionCells.Clear();
        optionGlows.Clear();
        optionLabels.Clear();

        for (int i = 0; i < 3; i++)
        {
            int idx = i;
            var cell = CreateUi($"MenuCell_{i}", menuCard.transform);
            var crt = cell.GetComponent<RectTransform>();
            crt.anchorMin = new Vector2(i / 3f, 0f);
            crt.anchorMax = new Vector2((i + 1) / 3f, 1f);
            crt.offsetMin = new Vector2(8f, 16f);
            crt.offsetMax = new Vector2(-8f, -16f);
            optionCells.Add(crt);

            var hit = cell.AddComponent<Image>();
            hit.color = new Color(1f, 1f, 1f, 0.01f);
            var btn = cell.AddComponent<Button>();
            btn.targetGraphic = hit;
            btn.transition = Selectable.Transition.ColorTint;
            var colors = btn.colors;
            colors.highlightedColor = new Color(1f, 0.92f, 0.55f, 0.22f);
            colors.pressedColor = new Color(1f, 0.88f, 0.4f, 0.35f);
            btn.colors = colors;
            btn.onClick.AddListener(() => OpenPanel(idx));

            // Soft rounded gold highlight plate behind icon (focus ring)
            var glowGo = CreateUi("FocusGlow", cell.transform);
            var grt = glowGo.GetComponent<RectTransform>();
            grt.anchorMin = grt.anchorMax = new Vector2(0.5f, 0.62f);
            grt.pivot = new Vector2(0.5f, 0.5f);
            grt.sizeDelta = new Vector2(190f, 190f);
            var gimg = glowGo.AddComponent<Image>();
            gimg.raycastTarget = false;
            gimg.preserveAspect = true;
            if (iconHighlight != null)
            {
                gimg.sprite = iconHighlight;
                gimg.type = Image.Type.Sliced;
                gimg.color = new Color(1f, 1f, 1f, 0.85f);
            }
            else
            {
                gimg.color = new Color(1f, 0.85f, 0.35f, 0.28f);
            }
            optionGlows.Add(gimg);

            // Big icon
            var iconGo = CreateUi("Icon", cell.transform);
            var irt = iconGo.GetComponent<RectTransform>();
            irt.anchorMin = irt.anchorMax = new Vector2(0.5f, 0.62f);
            irt.pivot = new Vector2(0.5f, 0.5f);
            irt.sizeDelta = new Vector2(180f, 180f);
            var iimg = iconGo.AddComponent<Image>();
            iimg.preserveAspect = true;
            iimg.raycastTarget = false;
            if (icons[i] != null)
            {
                iimg.sprite = icons[i];
                iimg.color = Color.white;
            }
            else iimg.color = Gold;

            var label = CreateText(cell.transform, labels[i], 26, TextAlignmentOptions.Center);
            var lrt = label.rectTransform;
            lrt.anchorMin = new Vector2(0.05f, 0f);
            lrt.anchorMax = new Vector2(0.95f, 0.28f);
            lrt.offsetMin = Vector2.zero;
            lrt.offsetMax = Vector2.zero;
            label.color = Gold; // highlighted label color for focus
            label.fontStyle = FontStyles.Bold;
            optionLabels.Add(label);

            // Faint vertical divider between columns (not after last)
            if (i < 2)
            {
                var div = CreateUi($"Divider_{i}", menuCard.transform);
                var drt = div.GetComponent<RectTransform>();
                float xNorm = (i + 1) / 3f;
                drt.anchorMin = new Vector2(xNorm, 0.18f);
                drt.anchorMax = new Vector2(xNorm, 0.82f);
                drt.sizeDelta = new Vector2(2f, 0f);
                drt.anchoredPosition = Vector2.zero;
                var dimg = div.AddComponent<Image>();
                dimg.color = Divider;
                dimg.raycastTarget = false;
            }
        }

        // Detail panel — same milky white sheet style
        panelRoot = CreateUi("SettingsDetailPanel", overlayRoot.transform);
        var prt = panelRoot.GetComponent<RectTransform>();
        prt.anchorMin = prt.anchorMax = new Vector2(0.5f, 0.5f);
        prt.pivot = new Vector2(0.5f, 0.5f);
        prt.sizeDelta = new Vector2(620f, 680f);
        var pbg = panelRoot.AddComponent<Image>();
        if (panelSheet != null)
        {
            pbg.sprite = panelSheet;
            pbg.type = Image.Type.Sliced;
            pbg.pixelsPerUnitMultiplier = 1.2f;
            pbg.color = new Color(1f, 1f, 1f, 0.95f);
        }
        else pbg.color = MilkWhite;
        pbg.raycastTarget = true;
        var pblock = panelRoot.AddComponent<Button>();
        pblock.targetGraphic = pbg;
        pblock.transition = Selectable.Transition.None;

        var close = CreateUi("CloseBtn", panelRoot.transform);
        var clrt = close.GetComponent<RectTransform>();
        clrt.anchorMin = clrt.anchorMax = new Vector2(1f, 1f);
        clrt.pivot = new Vector2(1f, 1f);
        clrt.sizeDelta = new Vector2(64f, 64f);
        clrt.anchoredPosition = new Vector2(-14f, -14f);
        var cimg = close.AddComponent<Image>();
        cimg.color = new Color(0.75f, 0.55f, 0.15f, 1f);
        var cbtn = close.AddComponent<Button>();
        cbtn.targetGraphic = cimg;
        cbtn.onClick.AddListener(() =>
        {
            if (panelRoot != null) panelRoot.SetActive(false);
            if (menuCard != null) menuCard.SetActive(true);
            menuOpen = true;
        });
        var cx = CreateText(close.transform, "✕", 30, TextAlignmentOptions.Center);
        Stretch(cx.rectTransform);
        cx.color = Color.white;

        var iconHolder = CreateUi("PanelIcon", panelRoot.transform);
        var phrt = iconHolder.GetComponent<RectTransform>();
        phrt.anchorMin = phrt.anchorMax = new Vector2(0.5f, 1f);
        phrt.pivot = new Vector2(0.5f, 1f);
        phrt.sizeDelta = new Vector2(140f, 140f);
        phrt.anchoredPosition = new Vector2(0f, -28f);
        panelIcon = iconHolder.AddComponent<Image>();
        panelIcon.preserveAspect = true;
        panelIcon.color = Color.white;

        panelTitle = CreateText(panelRoot.transform, "Title", 38, TextAlignmentOptions.Center);
        var trt = panelTitle.rectTransform;
        trt.anchorMin = new Vector2(0f, 1f);
        trt.anchorMax = new Vector2(1f, 1f);
        trt.pivot = new Vector2(0.5f, 1f);
        trt.sizeDelta = new Vector2(-40f, 50f);
        trt.anchoredPosition = new Vector2(0f, -180f);
        panelTitle.color = Gold;
        panelTitle.fontStyle = FontStyles.Bold;

        panelBody = CreateText(panelRoot.transform, "", 28, TextAlignmentOptions.TopLeft);
        var brt = panelBody.rectTransform;
        brt.anchorMin = new Vector2(0f, 0f);
        brt.anchorMax = new Vector2(1f, 1f);
        brt.offsetMin = new Vector2(40f, 36f);
        brt.offsetMax = new Vector2(-40f, -250f);
        panelBody.color = LabelDark;
        panelBody.enableWordWrapping = true;
        panelBody.overflowMode = TextOverflowModes.Overflow;
    }

    private void ToggleMenu()
    {
        menuOpen = !menuOpen;
        if (overlayRoot != null) overlayRoot.SetActive(menuOpen);
        if (menuOpen)
        {
            if (menuCard != null) menuCard.SetActive(true);
            if (panelRoot != null) panelRoot.SetActive(false);
            PlayOptionsHighlight();
        }
        else
        {
            StopOptionsHighlight();
        }
    }

    private void PlayOptionsHighlight()
    {
        StopOptionsHighlight();
        highlightSeq = DOTween.Sequence();

        // Pop each option in slightly so they feel focused
        for (int i = 0; i < optionCells.Count; i++)
        {
            var cell = optionCells[i];
            if (cell == null) continue;
            cell.localScale = Vector3.one * 0.88f;
            highlightSeq.Join(cell.DOScale(1.08f, 0.25f).SetEase(Ease.OutBack).SetDelay(i * 0.04f));
        }

        highlightSeq.AppendInterval(0.05f);

        for (int i = 0; i < optionCells.Count; i++)
        {
            var cell = optionCells[i];
            if (cell == null) continue;
            highlightSeq.Join(cell.DOScale(1f, 0.15f).SetEase(Ease.OutQuad));
        }

        // Soft pulse on gold highlight plates + labels
        for (int i = 0; i < optionGlows.Count; i++)
        {
            var glow = optionGlows[i];
            if (glow == null) continue;
            var c = glow.color;
            c.a = 0.4f;
            glow.color = c;
            highlightSeq.Join(glow.DOFade(1f, 0.5f).SetEase(Ease.InOutSine).SetLoops(6, LoopType.Yoyo));
        }
        for (int i = 0; i < optionLabels.Count; i++)
        {
            var lab = optionLabels[i];
            if (lab == null) continue;
            lab.color = Gold;
            highlightSeq.Join(lab.DOColor(new Color(1f, 0.9f, 0.3f, 1f), 0.45f).SetLoops(6, LoopType.Yoyo));
        }
    }

    private void StopOptionsHighlight()
    {
        if (highlightSeq != null)
        {
            highlightSeq.Kill(false);
            highlightSeq = null;
        }
        foreach (var cell in optionCells)
        {
            if (cell != null) cell.localScale = Vector3.one;
        }
        foreach (var glow in optionGlows)
        {
            if (glow == null) continue;
            glow.DOKill();
            var c = glow.color;
            c.a = 0.75f;
            glow.color = c;
        }
        foreach (var lab in optionLabels)
        {
            if (lab == null) continue;
            lab.DOKill();
            lab.color = Gold;
        }
    }

    private void OpenPanel(int index)
    {
        if (menuCard != null) menuCard.SetActive(false);
        if (panelRoot != null) panelRoot.SetActive(true);
        if (overlayRoot != null) overlayRoot.SetActive(true);
        menuOpen = true;

        switch (index)
        {
            case 0:
                panelTitle.text = "Bet History";
                SetPanelIcon(iconBet);
                panelBody.text = "Loading…";
                LoadBetHistory();
                break;
            case 1:
                panelTitle.text = "Game Rules";
                SetPanelIcon(iconRules);
                panelBody.text = RulesText;
                break;
            default:
                panelTitle.text = "Recent Results";
                SetPanelIcon(iconResults);
                panelBody.text = "Loading…";
                LoadRecentResults();
                break;
        }
    }

    private void SetPanelIcon(Sprite spr)
    {
        if (panelIcon == null) return;
        panelIcon.sprite = spr;
        panelIcon.color = spr != null ? Color.white : Gold;
    }

    private void LoadBetHistory()
    {
        var api = GameManager.Instance?.ApiClient;
        if (api == null)
        {
            panelBody.text = "Not signed in.\nSign in to view bet history.";
            return;
        }

        api.GetBetAmountSummary((ok, list, err) =>
        {
            if (!ok)
            {
                panelBody.text = "Could not load bets.\n" + (err ?? "");
                return;
            }

            var sb = new StringBuilder();
            sb.AppendLine("Current round bets");
            sb.AppendLine("─────────────────");
            bool any = false;
            if (list != null)
            {
                foreach (var b in list)
                {
                    if (b == null || b.amount <= 0) continue;
                    any = true;
                    sb.AppendLine($"●  Number {b.number}   ·  ₹{b.amount}");
                }
            }
            if (!any) sb.AppendLine("No open bets this round.");
            panelBody.text = sb.ToString();
        });
    }

    private void LoadRecentResults()
    {
        var api = GameManager.Instance?.ApiClient;
        if (api == null)
        {
            panelBody.text = "API unavailable.";
            return;
        }

        api.GetLastRoundResult((ok, r, err) =>
        {
            var sb = new StringBuilder();
            if (ok && r != null)
            {
                sb.AppendLine("Last round");
                sb.AppendLine("─────────────────");
                if (!string.IsNullOrEmpty(r.round_id))
                    sb.AppendLine($"Round: {r.round_id}");
                sb.AppendLine($"Dice: {r.dice1}, {r.dice2}, {r.dice3}, {r.dice4}, {r.dice5}, {r.dice6}");
                if (!string.IsNullOrEmpty(r.diceResult))
                    sb.AppendLine($"Result: {r.diceResult}");
                sb.AppendLine();
            }
            else
            {
                sb.AppendLine("Last round unavailable.");
                if (!string.IsNullOrEmpty(err)) sb.AppendLine(err);
                sb.AppendLine();
            }

            api.GetWinningFrequency((okF, freq, errF) =>
            {
                if (okF && freq != null)
                {
                    sb.AppendLine("Winning frequency");
                    sb.AppendLine("─────────────────");
                    AppendFrequency(sb, freq);
                }
                panelBody.text = sb.ToString();
            });
        });
    }

    private static void AppendFrequency(StringBuilder sb, GameApiClient.WinningFrequenceResponse freq)
    {
        if (freq?.WinningNumbers == null || freq.WinningNumbers.Count == 0)
        {
            sb.AppendLine("No frequency data.");
            return;
        }

        foreach (var w in freq.WinningNumbers)
        {
            if (w == null) continue;
            sb.AppendLine($"#{w.Number}  ×{w.Frequency}  (×{w.PayoutMultiplier:0.##})");
        }
    }

    public void CloseAll()
    {
        menuOpen = false;
        StopOptionsHighlight();
        if (overlayRoot != null) overlayRoot.SetActive(false);
        if (menuCard != null) menuCard.SetActive(false);
        if (panelRoot != null) panelRoot.SetActive(false);
    }

    private static GameObject CreateUi(string name, Transform parent)
    {
        var go = new GameObject(name, typeof(RectTransform));
        go.transform.SetParent(parent, false);
        return go;
    }

    private static TextMeshProUGUI CreateText(Transform parent, string text, float size, TextAlignmentOptions align)
    {
        var go = new GameObject("Text", typeof(RectTransform));
        go.transform.SetParent(parent, false);
        var tmp = go.AddComponent<TextMeshProUGUI>();
        tmp.text = text;
        tmp.fontSize = size;
        tmp.alignment = align;
        tmp.color = Gold;
        tmp.enableAutoSizing = false;
        tmp.raycastTarget = false;
        return tmp;
    }

    private static void Stretch(RectTransform rt)
    {
        rt.anchorMin = Vector2.zero;
        rt.anchorMax = Vector2.one;
        rt.offsetMin = Vector2.zero;
        rt.offsetMax = Vector2.zero;
    }

    private static Transform FindDeepChild(Transform root, string name)
    {
        if (root == null) return null;
        foreach (Transform t in root.GetComponentsInChildren<Transform>(true))
        {
            if (t.name == name) return t;
        }
        return null;
    }
}

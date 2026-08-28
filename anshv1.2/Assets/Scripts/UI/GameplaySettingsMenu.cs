using System.Collections;
using System.Collections.Generic;
using System.Linq;
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
    private GameObject betHistoryRoot;
    private RectTransform betHistoryContent;
    private TextMeshProUGUI betHistoryStatus;
    private GameObject gameRulesRoot;
    private TextMeshProUGUI gameRulesBody;
    private GameObject recentResultsRoot;
    private RectTransform recentResultsContent;
    private TextMeshProUGUI recentResultsStatus;
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
    private Coroutine recentResultsBuildRoutine;

    private static readonly Color Gold = new Color(0.78f, 0.62f, 0.18f, 1f);
    private static readonly Color MilkWhite = new Color(1f, 1f, 1f, 0.82f);
    private static readonly Color LabelDark = new Color(0.22f, 0.20f, 0.18f, 1f);
    private static readonly Color Divider = new Color(0.75f, 0.70f, 0.55f, 0.45f);
    // Soft dim so the game behind doesn't dominate; icons stay the focus
    private static readonly Color BackdropDim = new Color(0.02f, 0.05f, 0.04f, 0.55f);
    private static readonly Color ResultsSheet = new Color(0.94f, 0.88f, 0.74f, 0.93f);
    private static readonly Color DiceTile = new Color(0.98f, 0.96f, 0.91f, 1f);
    private static readonly Color DiceTileBorder = new Color(0.72f, 0.58f, 0.22f, 0.35f);
    private const int RecentResultsCount = 100;

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

        // Gear sits in the red bar below the number grid (Bottom panel), right side.
        CreateGearButton(transform as RectTransform);
        CreateOverlay(transform as RectTransform);
        CloseAll();
    }

    private void CreateGearButton(RectTransform host)
    {
        var go = new GameObject("SettingsGearBtn", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image), typeof(Button));
        var rt = go.GetComponent<RectTransform>();
        RectTransform parent = bottomBar != null ? bottomBar : host;
        rt.SetParent(parent, false);

        if (bottomBar != null)
        {
            // Right slot inside the maroon bar under the dice numbers.
            rt.anchorMin = new Vector2(0.895f, 0.24f);
            rt.anchorMax = new Vector2(0.965f, 0.76f);
            rt.pivot = new Vector2(1f, 0.5f);
            rt.offsetMin = Vector2.zero;
            rt.offsetMax = Vector2.zero;
        }
        else
        {
            rt.anchorMin = new Vector2(1f, 0.5f);
            rt.anchorMax = new Vector2(1f, 0.5f);
            rt.pivot = new Vector2(1f, 0.5f);
            rt.sizeDelta = new Vector2(62f, 62f);
            rt.anchoredPosition = new Vector2(-12f, -280f);
        }

        rt.SetAsLastSibling();

        var img = go.GetComponent<Image>();
        img.preserveAspect = true;
        img.raycastTarget = true;
        Sprite spr = gearSprite != null
            ? gearSprite
            : Resources.Load<Sprite>("UI/settings_gear_only")
              ?? Resources.Load<Sprite>("UI/settings_gear");
        if (spr != null)
        {
            img.sprite = spr;
            img.color = Color.white;
        }
        else
        {
            img.color = Gold;
        }

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
        // Center of screen — milky card matching the reference layout
        mrt.sizeDelta = new Vector2(860f, 360f);
        mrt.anchoredPosition = Vector2.zero;

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
            label.color = LabelDark; // dark labels like the reference card
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

        // Detail panels — large centered sheets (~65% of screen height)
        var betShell = CreateDetailSheetShell(
            "BetHistorySheet", iconBet, "BET HISTORY", "Current Round", CloseBetHistory);
        betHistoryRoot = betShell.Root;
        betHistoryContent = betShell.ScrollContent;
        betHistoryStatus = betShell.StatusText;

        var rulesShell = CreateDetailSheetShell(
            "GameRulesSheet", iconRules, "GAME RULES", "How to Play", CloseGameRules);
        gameRulesRoot = rulesShell.Root;
        gameRulesBody = CreateText(rulesShell.ScrollContent, RulesText, 26, TextAlignmentOptions.TopLeft);
        var rulesBodyRt = gameRulesBody.rectTransform;
        rulesBodyRt.anchorMin = new Vector2(0f, 1f);
        rulesBodyRt.anchorMax = new Vector2(1f, 1f);
        rulesBodyRt.pivot = new Vector2(0.5f, 1f);
        rulesBodyRt.offsetMin = new Vector2(8f, rulesBodyRt.offsetMin.y);
        rulesBodyRt.offsetMax = new Vector2(-8f, rulesBodyRt.offsetMax.y);
        rulesBodyRt.sizeDelta = new Vector2(0f, 0f);
        gameRulesBody.color = LabelDark;
        gameRulesBody.enableWordWrapping = true;
        gameRulesBody.overflowMode = TextOverflowModes.Overflow;
        var rulesBodyCsf = gameRulesBody.gameObject.AddComponent<ContentSizeFitter>();
        rulesBodyCsf.horizontalFit = ContentSizeFitter.FitMode.Unconstrained;
        rulesBodyCsf.verticalFit = ContentSizeFitter.FitMode.PreferredSize;

        CreateRecentResultsFullScreen();
    }

    private struct DetailSheetShell
    {
        public GameObject Root;
        public RectTransform ScrollContent;
        public TextMeshProUGUI StatusText;
    }

    private DetailSheetShell CreateDetailSheetShell(
        string name,
        Sprite headerIcon,
        string title,
        string subtitle,
        UnityEngine.Events.UnityAction onClose)
    {
        var shell = new DetailSheetShell();
        shell.Root = CreateUi(name, overlayRoot.transform);
        Stretch(shell.Root.GetComponent<RectTransform>());
        shell.Root.SetActive(false);

        var card = CreateUi("SheetCard", shell.Root.transform);
        var cardRt = card.GetComponent<RectTransform>();
        // ~88% width, ~66% height — at least half the playable area
        cardRt.anchorMin = new Vector2(0.06f, 0.17f);
        cardRt.anchorMax = new Vector2(0.94f, 0.83f);
        cardRt.offsetMin = Vector2.zero;
        cardRt.offsetMax = Vector2.zero;
        cardRt.pivot = new Vector2(0.5f, 0.5f);

        var sheet = card.AddComponent<Image>();
        sheet.color = ResultsSheet;
        sheet.raycastTarget = true;
        var block = card.AddComponent<Button>();
        block.targetGraphic = sheet;
        block.transition = Selectable.Transition.None;

        var iconGo = CreateUi("HeaderIcon", card.transform);
        var iconRt = iconGo.GetComponent<RectTransform>();
        iconRt.anchorMin = iconRt.anchorMax = new Vector2(0f, 1f);
        iconRt.pivot = new Vector2(0f, 1f);
        iconRt.sizeDelta = new Vector2(100f, 100f);
        iconRt.anchoredPosition = new Vector2(20f, -16f);
        var iconImg = iconGo.AddComponent<Image>();
        iconImg.preserveAspect = true;
        iconImg.raycastTarget = false;
        if (headerIcon != null) { iconImg.sprite = headerIcon; iconImg.color = Color.white; }

        var titleText = CreateText(card.transform, title, 38, TextAlignmentOptions.Center);
        var titleRt = titleText.rectTransform;
        titleRt.anchorMin = new Vector2(0.08f, 1f);
        titleRt.anchorMax = new Vector2(0.92f, 1f);
        titleRt.pivot = new Vector2(0.5f, 1f);
        titleRt.sizeDelta = new Vector2(0f, 48f);
        titleRt.anchoredPosition = new Vector2(0f, -24f);
        titleText.color = Gold;
        titleText.fontStyle = FontStyles.Bold;

        var subtitleText = CreateText(card.transform, subtitle, 26, TextAlignmentOptions.Center);
        var subRt = subtitleText.rectTransform;
        subRt.anchorMin = new Vector2(0.08f, 1f);
        subRt.anchorMax = new Vector2(0.92f, 1f);
        subRt.pivot = new Vector2(0.5f, 1f);
        subRt.sizeDelta = new Vector2(0f, 34f);
        subRt.anchoredPosition = new Vector2(0f, -78f);
        subtitleText.color = new Color(0.45f, 0.32f, 0.18f, 1f);

        var close = CreateUi("CloseBtn", card.transform);
        var clrt = close.GetComponent<RectTransform>();
        clrt.anchorMin = clrt.anchorMax = new Vector2(1f, 1f);
        clrt.pivot = new Vector2(1f, 1f);
        clrt.sizeDelta = new Vector2(64f, 64f);
        clrt.anchoredPosition = new Vector2(-12f, -12f);
        close.AddComponent<Image>().color = new Color(0.75f, 0.55f, 0.15f, 1f);
        close.AddComponent<Button>().onClick.AddListener(onClose);
        var cx = CreateText(close.transform, "✕", 28, TextAlignmentOptions.Center);
        Stretch(cx.rectTransform);
        cx.color = Color.white;

        var scrollGo = CreateUi("Scroll", card.transform);
        var scrollRt = scrollGo.GetComponent<RectTransform>();
        scrollRt.anchorMin = Vector2.zero;
        scrollRt.anchorMax = Vector2.one;
        scrollRt.offsetMin = new Vector2(20f, 20f);
        scrollRt.offsetMax = new Vector2(-20f, -120f);

        scrollGo.AddComponent<Image>().color = new Color(1f, 1f, 1f, 0.08f);
        var scroll = scrollGo.AddComponent<ScrollRect>();
        scroll.horizontal = false;
        scroll.vertical = true;
        scroll.movementType = ScrollRect.MovementType.Clamped;
        scroll.scrollSensitivity = 24f;

        var viewport = CreateUi("Viewport", scrollGo.transform);
        var vpRt = viewport.GetComponent<RectTransform>();
        Stretch(vpRt);
        viewport.AddComponent<Image>().color = new Color(1f, 1f, 1f, 0.01f);
        viewport.AddComponent<Mask>().showMaskGraphic = false;

        shell.ScrollContent = CreateUi("Content", viewport.transform).GetComponent<RectTransform>();
        Stretch(shell.ScrollContent);
        shell.ScrollContent.pivot = new Vector2(0.5f, 1f);
        shell.ScrollContent.anchorMin = new Vector2(0f, 1f);
        shell.ScrollContent.anchorMax = new Vector2(1f, 1f);
        shell.ScrollContent.offsetMin = new Vector2(0f, shell.ScrollContent.offsetMin.y);
        shell.ScrollContent.offsetMax = new Vector2(0f, shell.ScrollContent.offsetMax.y);

        var vlg = shell.ScrollContent.gameObject.AddComponent<VerticalLayoutGroup>();
        vlg.spacing = 0f;
        vlg.padding = new RectOffset(4, 4, 2, 2);
        vlg.childAlignment = TextAnchor.UpperCenter;
        vlg.childControlWidth = true;
        vlg.childControlHeight = true;
        vlg.childForceExpandWidth = true;
        vlg.childForceExpandHeight = false;

        shell.ScrollContent.gameObject.AddComponent<ContentSizeFitter>().verticalFit =
            ContentSizeFitter.FitMode.PreferredSize;

        scroll.viewport = vpRt;
        scroll.content = shell.ScrollContent;

        shell.StatusText = CreateText(card.transform, "Loading…", 26, TextAlignmentOptions.Center);
        var stRt = shell.StatusText.rectTransform;
        stRt.anchorMin = new Vector2(0.1f, 0.5f);
        stRt.anchorMax = new Vector2(0.9f, 0.5f);
        stRt.sizeDelta = new Vector2(0f, 56f);
        shell.StatusText.color = LabelDark;

        return shell;
    }

    private void CreateRecentResultsFullScreen()
    {
        var shell = CreateDetailSheetShell(
            "RecentResultsSheet", iconResults, "RECENT RESULTS", "Last 100 Rounds", CloseRecentResults);
        recentResultsRoot = shell.Root;
        recentResultsContent = shell.ScrollContent;
        recentResultsStatus = shell.StatusText;
    }

    private void ToggleMenu()
    {
        menuOpen = !menuOpen;
        if (overlayRoot != null) overlayRoot.SetActive(menuOpen);
        if (menuOpen)
        {
            if (menuCard != null) menuCard.SetActive(true);
            HideAllFullScreens();
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
            lab.color = LabelDark;
            highlightSeq.Join(lab.DOColor(Gold, 0.45f).SetLoops(6, LoopType.Yoyo));
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
            lab.color = LabelDark;
        }
    }

    private void OpenPanel(int index)
    {
        if (menuCard != null) menuCard.SetActive(false);
        HideAllFullScreens();
        if (overlayRoot != null) overlayRoot.SetActive(true);
        menuOpen = true;

        switch (index)
        {
            case 0:
                OpenBetHistoryFullScreen();
                break;
            case 1:
                OpenGameRulesFullScreen();
                break;
            default:
                OpenRecentResultsFullScreen();
                break;
        }
    }

    private void HideAllFullScreens()
    {
        if (betHistoryRoot != null) betHistoryRoot.SetActive(false);
        if (gameRulesRoot != null) gameRulesRoot.SetActive(false);
        if (recentResultsRoot != null) recentResultsRoot.SetActive(false);
    }

    private void OpenBetHistoryFullScreen()
    {
        if (betHistoryRoot != null) betHistoryRoot.SetActive(true);
        ClearBetHistoryRows();
        if (betHistoryStatus != null)
        {
            betHistoryStatus.gameObject.SetActive(true);
            betHistoryStatus.text = "Loading…";
        }
        LoadBetHistory();
    }

    private void OpenGameRulesFullScreen()
    {
        if (gameRulesRoot != null) gameRulesRoot.SetActive(true);
    }

    private void CloseBetHistory()
    {
        if (betHistoryRoot != null) betHistoryRoot.SetActive(false);
        if (menuCard != null) menuCard.SetActive(true);
        menuOpen = true;
    }

    private void CloseGameRules()
    {
        if (gameRulesRoot != null) gameRulesRoot.SetActive(false);
        if (menuCard != null) menuCard.SetActive(true);
        menuOpen = true;
    }

    private void OpenRecentResultsFullScreen()
    {
        if (recentResultsRoot != null) recentResultsRoot.SetActive(true);
        if (overlayRoot != null) overlayRoot.SetActive(true);
        menuOpen = true;
        ClearRecentResultsRows();
        if (recentResultsStatus != null)
        {
            recentResultsStatus.gameObject.SetActive(true);
            recentResultsStatus.text = "Loading…";
        }
        LoadRecentResults();
    }

    private void CloseRecentResults()
    {
        if (recentResultsRoot != null) recentResultsRoot.SetActive(false);
        if (menuCard != null) menuCard.SetActive(true);
        menuOpen = true;
    }

    private void LoadBetHistory()
    {
        var api = GameManager.Instance?.ApiClient;
        if (api == null)
        {
            if (betHistoryStatus != null)
                betHistoryStatus.text = "Not signed in.\nSign in to view bet history.";
            return;
        }

        api.GetBetAmountSummary((ok, list, err) =>
        {
            ClearBetHistoryRows();
            if (!ok)
            {
                if (betHistoryStatus != null)
                {
                    betHistoryStatus.gameObject.SetActive(true);
                    betHistoryStatus.text = "Could not load bets.\n" + (err ?? "");
                }
                return;
            }

            bool any = false;
            if (list != null)
            {
                int rowIndex = 0;
                foreach (var b in list)
                {
                    if (b == null || b.amount <= 0) continue;
                    any = true;
                    BuildBetHistoryRow(b.number, b.amount, rowIndex++);
                }
            }

            if (!any)
            {
                if (betHistoryStatus != null)
                {
                    betHistoryStatus.gameObject.SetActive(true);
                    betHistoryStatus.text = "No open bets this round.";
                }
                return;
            }

            if (betHistoryStatus != null)
                betHistoryStatus.gameObject.SetActive(false);

            if (betHistoryContent != null)
                LayoutRebuilder.ForceRebuildLayoutImmediate(betHistoryContent);
        });
    }

    private void ClearBetHistoryRows()
    {
        if (betHistoryContent == null) return;
        for (int i = betHistoryContent.childCount - 1; i >= 0; i--)
            Destroy(betHistoryContent.GetChild(i).gameObject);
    }

    private void BuildBetHistoryRow(int number, float amount, int index)
    {
        if (betHistoryContent == null) return;

        var block = CreateUi($"BetBlock_{index}", betHistoryContent);
        var blockLe = block.AddComponent<LayoutElement>();
        blockLe.minHeight = 66f;
        blockLe.preferredHeight = 66f;

        var row = CreateUi("Row", block.transform);
        var rowLe = row.AddComponent<LayoutElement>();
        rowLe.minHeight = 58f;
        rowLe.preferredHeight = 58f;
        var rowLayout = row.AddComponent<HorizontalLayoutGroup>();
        rowLayout.padding = new RectOffset(12, 12, 8, 8);
        rowLayout.childAlignment = TextAnchor.MiddleLeft;
        rowLayout.childControlWidth = true;
        rowLayout.childForceExpandWidth = true;

        var label = CreateText(row.transform, $"●  Number {number}   ·  ₹{amount:0}", 26, TextAlignmentOptions.MidlineLeft);
        label.color = LabelDark;
        label.fontStyle = FontStyles.Bold;
        var labelLe = label.gameObject.AddComponent<LayoutElement>();
        labelLe.flexibleWidth = 1f;

        var div = CreateUi("Divider", block.transform);
        div.GetComponent<RectTransform>().sizeDelta = new Vector2(0f, 2f);
        var divLe = div.AddComponent<LayoutElement>();
        divLe.minHeight = 2f;
        divLe.preferredHeight = 2f;
        div.AddComponent<Image>().color = Divider;
    }

    private void LoadRecentResults()
    {
        var api = GameManager.Instance?.ApiClient;
        if (api == null)
        {
            if (recentResultsStatus != null)
                recentResultsStatus.text = "API unavailable.";
            return;
        }

        api.GetRecentRoundResults(RecentResultsCount, (ok, list, err) =>
        {
            ClearRecentResultsRows();
            if (!ok || list == null || list.Count == 0)
            {
                if (recentResultsStatus != null)
                {
                    recentResultsStatus.gameObject.SetActive(true);
                    recentResultsStatus.text = string.IsNullOrEmpty(err)
                        ? "No recent results."
                        : "Could not load results.\n" + err;
                }
                return;
            }

            if (recentResultsStatus != null)
                recentResultsStatus.gameObject.SetActive(false);

            if (recentResultsBuildRoutine != null)
                StopCoroutine(recentResultsBuildRoutine);
            recentResultsBuildRoutine = StartCoroutine(BuildRecentResultsRowsRoutine(list));
        });
    }

    private IEnumerator BuildRecentResultsRowsRoutine(List<GameApiClient.RecentRoundResultEntry> list)
    {
        var vlg = recentResultsContent != null ? recentResultsContent.GetComponent<VerticalLayoutGroup>() : null;
        var csf = recentResultsContent != null ? recentResultsContent.GetComponent<ContentSizeFitter>() : null;
        if (vlg != null) vlg.enabled = false;
        if (csf != null) csf.enabled = false;

        const int rowsPerFrame = 6;
        for (int i = 0; i < list.Count; i++)
        {
            BuildRecentResultRow(list[i], i);
            if ((i + 1) % rowsPerFrame == 0)
                yield return null;
        }

        if (vlg != null) vlg.enabled = true;
        if (csf != null) csf.enabled = true;
        if (recentResultsContent != null)
            LayoutRebuilder.ForceRebuildLayoutImmediate(recentResultsContent);

        recentResultsBuildRoutine = null;
    }

    private void ClearRecentResultsRows()
    {
        if (recentResultsBuildRoutine != null)
        {
            StopCoroutine(recentResultsBuildRoutine);
            recentResultsBuildRoutine = null;
        }

        if (recentResultsContent == null) return;
        for (int i = recentResultsContent.childCount - 1; i >= 0; i--)
            Destroy(recentResultsContent.GetChild(i).gameObject);
    }

    private static string FormatRoundShortId(string roundId)
    {
        if (string.IsNullOrEmpty(roundId)) return "#----";
        var digits = new string(roundId.Where(char.IsDigit).ToArray());
        if (string.IsNullOrEmpty(digits)) return "#----";
        if (digits.Length >= 4) return "#" + digits.Substring(digits.Length - 4);
        return "#" + digits.PadLeft(4, '0');
    }

    private void BuildRecentResultRow(GameApiClient.RecentRoundResultEntry entry, int index)
    {
        if (recentResultsContent == null || entry == null) return;

        var block = CreateUi($"ResultBlock_{index}", recentResultsContent);
        var blockLe = block.AddComponent<LayoutElement>();
        blockLe.minHeight = 66f;
        blockLe.preferredHeight = 66f;

        var blockVlg = block.AddComponent<VerticalLayoutGroup>();
        blockVlg.spacing = 0f;
        blockVlg.padding = new RectOffset(0, 0, 0, 0);
        blockVlg.childControlWidth = true;
        blockVlg.childControlHeight = true;
        blockVlg.childForceExpandWidth = true;
        blockVlg.childForceExpandHeight = false;

        var row = CreateUi("Row", block.transform);
        var rowRt = row.GetComponent<RectTransform>();
        rowRt.sizeDelta = new Vector2(0f, 60f);
        var rowLe = row.AddComponent<LayoutElement>();
        rowLe.minHeight = 60f;
        rowLe.preferredHeight = 60f;

        var rowLayout = row.AddComponent<HorizontalLayoutGroup>();
        rowLayout.spacing = 8f;
        rowLayout.padding = new RectOffset(4, 4, 4, 4);
        rowLayout.childAlignment = TextAnchor.MiddleLeft;
        rowLayout.childControlWidth = false;
        rowLayout.childControlHeight = true;
        rowLayout.childForceExpandWidth = false;
        rowLayout.childForceExpandHeight = true;

        var idLabel = CreateText(row.transform, FormatRoundShortId(entry.round_id), 26, TextAlignmentOptions.MidlineLeft);
        idLabel.color = new Color(0.42f, 0.30f, 0.16f, 1f);
        idLabel.fontStyle = FontStyles.Bold;
        idLabel.rectTransform.sizeDelta = new Vector2(98f, 54f);
        var idLe = idLabel.gameObject.AddComponent<LayoutElement>();
        idLe.minWidth = 98f;
        idLe.preferredWidth = 98f;

        var diceValues = entry.AllDice;
        for (int d = 0; d < 6; d++)
        {
            int value = d < diceValues.Length ? diceValues[d] : 0;
            if (value < 1 || value > 6) value = 1;

            var tile = CreateUi($"Dice_{d}", row.transform);
            tile.GetComponent<RectTransform>().sizeDelta = new Vector2(50f, 50f);
            var tileLe = tile.AddComponent<LayoutElement>();
            tileLe.minWidth = 50f;
            tileLe.preferredWidth = 50f;
            tileLe.minHeight = 50f;
            tileLe.preferredHeight = 50f;

            var tileImg = tile.AddComponent<Image>();
            tileImg.color = DiceTile;

            var outline = tile.AddComponent<Outline>();
            outline.effectColor = DiceTileBorder;
            outline.effectDistance = new Vector2(1.5f, -1.5f);

            var num = CreateText(tile.transform, value.ToString(), 22, TextAlignmentOptions.Center);
            Stretch(num.rectTransform);
            num.color = LabelDark;
            num.fontStyle = FontStyles.Bold;
        }

        var div = CreateUi("Divider", block.transform);
        div.GetComponent<RectTransform>().sizeDelta = new Vector2(0f, 2f);
        var divLe = div.AddComponent<LayoutElement>();
        divLe.minHeight = 2f;
        divLe.preferredHeight = 2f;
        div.AddComponent<Image>().color = Divider;
    }

    public void CloseAll()
    {
        menuOpen = false;
        StopOptionsHighlight();
        if (overlayRoot != null) overlayRoot.SetActive(false);
        if (menuCard != null) menuCard.SetActive(false);
        HideAllFullScreens();
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

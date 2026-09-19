// ==UserScript==
// @name         ulepszator by Kruul
// @namespace    http://tampermonkey.net/
// @version      0.1.8
// @description  Auto ulepszanie i rozbijanie
// @author       Kruul
// @match        https://*.margonem.pl/
// @updateURL    https://raw.githubusercontent.com/kruulxd/ulepszarka-demo/main/ulepszarka-wild.user.js
// @downloadURL  https://raw.githubusercontent.com/kruulxd/ulepszarka-demo/main/ulepszarka-wild.user.js
// @grant        none
// ==/UserScript==

const CONFIG = {
  DEFAULT_ALLOWED_RARITIES: ["common"],
  AVAILABLE_RARITIES: ["common", "unique", "heroic"],
  DEFAULT_MODE: "enhancement",
  AVAILABLE_MODES: ["enhancement", "salvage"],
  MAX_REAGENTS: 25,
  DEFAULT_HOTKEYS: {
    enhance: "j",
    salvage: "k",
    gui: "u",
  },
  DEFAULT_BUTTON_POSITION: {
    left: null,
    top: 150,
    right: 16,
  },
  DEFAULT_PANEL_POSITION: {
    left: null,
    top: 188,
    right: 16,
  },
  DEFAULT_AUTO_SETTINGS: {
    enabled: false,
    minFreeSlots: 6,
  },
  DAILY_RESET_TIME: {
    hour: 5,
    minute: 25,
  },
  AUTO_MIN_FREE_SLOTS_RANGE: {
    min: 1,
    max: 30,
  },
  DEFAULT_BOUND_SETTINGS: {
    allowSoulbound: false,
    allowPermbound: false,
  },
  DAILY_POINTS_DEFAULT: 0,
};

const CL = {
  ONE_HAND_WEAPON: 1,
  TWO_HAND_WEAPON: 2,
  ONE_AND_HALF_HAND_WEAPON: 3,
  DISTANCE_WEAPON: 4,
  HELP_WEAPON: 5,
  WAND_WEAPON: 6,
  ORB_WEAPON: 7,
  ARMOR: 8,
  HELMET: 9,
  BOOTS: 10,
  GLOVES: 11,
  RING: 12,
  NECKLACE: 13,
  SHIELD: 14,
  NEUTRAL: 15,
  CONSUME: 16,
  GOLD: 17,
  KEYS: 18,
  QUEST: 19,
  RENEWABLE: 20,
  ARROWS: 21,
  TALISMAN: 22,
  BOOK: 23,
  BAG: 24,
  BLESS: 25,
  UPGRADE: 26,
  RECIPE: 27,
  COINAGE: 28,
  QUIVER: 29,
  OUTFITS: 30,
  PETS: 31,
  TELEPORTS: 32,
};

const ALLOWED_ITEM_TYPES = [
  CL.ONE_HAND_WEAPON,
  CL.TWO_HAND_WEAPON,
  CL.ONE_AND_HALF_HAND_WEAPON,
  CL.DISTANCE_WEAPON,
  CL.HELP_WEAPON,
  CL.WAND_WEAPON,
  CL.ORB_WEAPON,
  CL.ARMOR,
  CL.HELMET,
  CL.BOOTS,
  CL.GLOVES,
  CL.RING,
  CL.NECKLACE,
  CL.SHIELD,
  CL.QUIVER,
];

(function () {
  const state = {
    guiVisible: false,
    hotkeys: { ...CONFIG.DEFAULT_HOTKEYS },
    autoSettings: { ...CONFIG.DEFAULT_AUTO_SETTINGS },
    boundSettings: { ...CONFIG.DEFAULT_BOUND_SETTINGS },
    enhanceCounter: null,
    dailyEnhancePoints: CONFIG.DAILY_POINTS_DEFAULT,
    enhancementProgressHooked: false,
    salvageMessageHooked: false,
    lastProgressEventKey: null,
    lastProgressEventAt: 0,
    enhancementRunSummary: null,
    salvageReceivedItems: [],
    isEnhancing: false,
    mode: CONFIG.DEFAULT_MODE,
    lastAutoTriggerAt: 0,
    viewportSize: null,
    hasInterfaceWidget: false,
    interfaceWidgetDragObserver: null,
    launcherVisible: false,
    enhancementNotificationTimer: null,
    salvageNotificationTimer: null,
  };

  const Utils = {
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    chunk(array, chunkSize) {
      const chunks = [];
      for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
      }
      return chunks;
    },

    getItemIdFromClassName(className) {
      if (!className) return null;
      const match = className.match(/item-id-(\d+)/);
      return match ? match[1] : null;
    },

    normalizeHotkey(value, fallback) {
      const input = String(value || "").trim().toLowerCase();
      if (!input) return fallback;
      return input[0];
    },

    clamp(value, min, max) {
      return Math.min(Math.max(value, min), max);
    },

    toNumber(value, fallback) {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    },

    normalizeText(value) {
      const polishMap = {
        ą: "a",
        ć: "c",
        ę: "e",
        ł: "l",
        ń: "n",
        ó: "o",
        ś: "s",
        ź: "z",
        ż: "z",
      };

      return String(value || "")
        .toLowerCase()
        .replace(/[ąćęłńóśźż]/g, (char) => polishMap[char] || char)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    },

    truncateText(value, maxLength = 28) {
      const text = String(value || "").trim();
      if (!text) return "Przedmiot";
      if (text.length <= maxLength) return text;
      return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
    },

    parseEnhanceCounter(rawText) {
      const text = String(rawText || "").trim();
      if (!text) return null;

      const digits = text.match(/\d+/g);
      if (!digits || digits.length < 2) return null;

      const current = Utils.toNumber(digits[0], NaN);
      const limit = Utils.toNumber(digits[1], NaN);

      if (!Number.isFinite(current) || !Number.isFinite(limit) || limit <= 0) {
        return null;
      }

      return {
        current,
        limit,
        text: `${current}/${limit}`,
      };
    },

    getEnhanceCounterSnapshot() {
      const source =
        document.querySelector(".enhance__counter") ||
        document.querySelector("span.enhance_counter") ||
        document.querySelector(".enhance_counter");
      const parsedFromDom = Utils.parseEnhanceCounter(source?.textContent?.trim());
      if (parsedFromDom) return parsedFromDom;

      const parsedFromState = Utils.parseEnhanceCounter(state.enhanceCounter);
      if (parsedFromState) return parsedFromState;

      const cached = Storage.getEnhanceCounter();
      return Utils.parseEnhanceCounter(cached);
    },

    parsePointsNumber(rawText) {
      const text = String(rawText || "").trim();
      if (!text) return null;

      const compact = text.replace(/\s+/g, "");
      const match = compact.match(/[+-]?\d+/);
      if (!match) return null;

      const value = Utils.toNumber(match[0], NaN);
      return Number.isFinite(value) ? value : null;
    },

    getEnhancePreviewPoints() {
      const previewNode = document.querySelector(
        ".enhance__progress-text.enhance__progress-text--preview"
      );

      return Utils.parsePointsNumber(previewNode?.textContent);
    },

    formatPoints(value) {
      const points = Math.max(0, Math.floor(Utils.toNumber(value, 0)));
      return points.toLocaleString("pl-PL");
    },

    getDailyResetCycleKey(timestamp = Date.now()) {
      const currentDate = new Date(timestamp);
      if (Number.isNaN(currentDate.getTime())) return null;

      const resetDate = new Date(currentDate);
      resetDate.setHours(
        CONFIG.DAILY_RESET_TIME.hour,
        CONFIG.DAILY_RESET_TIME.minute,
        0,
        0
      );

      if (currentDate < resetDate) {
        resetDate.setDate(resetDate.getDate() - 1);
      }

      const year = resetDate.getFullYear();
      const month = String(resetDate.getMonth() + 1).padStart(2, "0");
      const day = String(resetDate.getDate()).padStart(2, "0");

      return `${year}-${month}-${day}`;
    },

    hasMaxEnhancementState(payload) {
      if (!payload || typeof payload !== "object") return false;

      const directFlags = [
        payload?.enhancement?.isMax,
        payload?.enhancement?.max,
        payload?.enhancement?.maxed,
        payload?.enhancement?.is_max,
        payload?.enhancement?.is_maxed,
        payload?.enhancement?.maxLevel,
        payload?.enhancement?.max_level,
      ];

      if (directFlags.some((value) => value === true)) {
        return true;
      }

      const enhancement = payload?.enhancement;
      const upgradeLevel = Utils.toNumber(
        enhancement?.progressing?.upgradeLevel ??
          enhancement?.progressing?.upgrade_level ??
          enhancement?.upgradeLevel ??
          enhancement?.upgrade_level,
        NaN
      );

      const usageCount = Utils.toNumber(
        enhancement?.usages_preview?.count ?? enhancement?.usage?.count,
        NaN
      );
      const usageLimit = Utils.toNumber(
        enhancement?.usages_preview?.limit ?? enhancement?.usage?.limit,
        NaN
      );

      const textProbe = Utils.normalizeText(
        JSON.stringify([
          payload?.error,
          payload?.msg,
          payload?.message,
          payload?.tip,
          payload?.enhancement?.error,
          payload?.enhancement?.msg,
          payload?.enhancement?.message,
        ])
      );

      const hasTextSignal =
        /(maks|max).*(ulepsz|enhanc)/.test(textProbe) ||
        /(wybierz|wybor).*(bonus)/.test(textProbe) ||
        /(bonus).*(wybierz|wybor)/.test(textProbe);

      const queue = [payload];
      const seen = new Set();
      let hasBonusArraySignal = false;
      let hasLegendaryCostSignal = false;

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || typeof current !== "object") continue;
        if (seen.has(current)) continue;
        seen.add(current);

        if (Array.isArray(current)) {
          if (current.length >= 3) {
            const objectLikeCount = current.filter(
              (entry) => entry && typeof entry === "object"
            ).length;
            if (objectLikeCount >= 2) {
              hasBonusArraySignal = true;
            }
          }

          current.forEach((entry) => queue.push(entry));
          continue;
        }

        Object.entries(current).forEach(([rawKey, value]) => {
          const key = Utils.normalizeText(rawKey);

          if (
            key.includes("bonus") &&
            Array.isArray(value) &&
            value.length >= 3
          ) {
            hasBonusArraySignal = true;
          }

          if (
            (key.includes("legend") || key.includes("esenc")) &&
            typeof value === "number" &&
            value > 0
          ) {
            hasLegendaryCostSignal = true;
          }

          if (value && typeof value === "object") {
            queue.push(value);
          }
        });
      }

      const looksLikeMaxLevelState =
        hasBonusArraySignal &&
        (hasLegendaryCostSignal || hasTextSignal || (Number.isFinite(upgradeLevel) && upgradeLevel >= 4));

      const maxedByUsageCounter =
        Number.isFinite(usageCount) &&
        Number.isFinite(usageLimit) &&
        usageLimit > 0 &&
        usageCount >= usageLimit;

      if (looksLikeMaxLevelState) {
        return true;
      }

      if (maxedByUsageCounter && hasTextSignal) {
        return true;
      }

      return false;
    },

  };

  const Storage = {
    getUpgradedItemKey() {
      return `upgrader-charId-${Engine.hero.d.id}`;
    },

    getRaritiesKey() {
      return `upgrader-rarities-charId-${Engine.hero.d.id}`;
    },

    getHotkeysKey() {
      return `upgrader-hotkeys-charId-${Engine.hero.d.id}`;
    },

    getGuiPositionKey() {
      return `upgrader-button-position-charId-${Engine.hero.d.id}`;
    },

    getPanelPositionKey() {
      return `upgrader-panel-position-charId-${Engine.hero.d.id}`;
    },

    getWidgetSlotKey() {
      return `upgrader-widget-slot-charId-${Engine.hero.d.id}`;
    },

    getAutoSettingsKey() {
      return `upgrader-auto-settings-charId-${Engine.hero.d.id}`;
    },

    getBoundSettingsKey() {
      return `upgrader-bound-settings-charId-${Engine.hero.d.id}`;
    },

    getModeKey() {
      return `upgrader-mode-charId-${Engine.hero.d.id}`;
    },

    getEnhanceCounterKey() {
      return "upgrader-enhance-counter-shared";
    },

    getDailyEnhancePointsKey() {
      return "upgrader-daily-enhance-points-shared";
    },

    getLegacyEnhanceCounterKey() {
      return `upgrader-enhance-counter-charId-${Engine.hero.d.id}`;
    },

    getLegacyDailyEnhancePointsKey() {
      return `upgrader-daily-enhance-points-charId-${Engine.hero.d.id}`;
    },

    getLauncherVisibilityKey() {
      return `upgrader-launcher-visible-charId-${Engine.hero.d.id}`;
    },

    getUpgradedItemId() {
      return window.localStorage.getItem(Storage.getUpgradedItemKey());
    },

    setUpgradedItemId(itemId) {
      window.localStorage.setItem(Storage.getUpgradedItemKey(), itemId);
    },

    getAllowedRarities() {
      const saved = window.localStorage.getItem(Storage.getRaritiesKey());
      if (!saved) {
        return [...CONFIG.DEFAULT_ALLOWED_RARITIES];
      }

      try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          return [...CONFIG.DEFAULT_ALLOWED_RARITIES];
        }

        return parsed.filter((rarity) => CONFIG.AVAILABLE_RARITIES.includes(rarity));
      } catch (error) {
        return [...CONFIG.DEFAULT_ALLOWED_RARITIES];
      }
    },

    setAllowedRarities(rarities) {
      const normalized = rarities.filter((rarity) =>
        CONFIG.AVAILABLE_RARITIES.includes(rarity)
      );

      const finalRarities =
        normalized.length > 0 ? normalized : [...CONFIG.DEFAULT_ALLOWED_RARITIES];

      window.localStorage.setItem(
        Storage.getRaritiesKey(),
        JSON.stringify(finalRarities)
      );
    },

    getHotkeys() {
      const saved = window.localStorage.getItem(Storage.getHotkeysKey());
      if (!saved) {
        return { ...CONFIG.DEFAULT_HOTKEYS };
      }

      try {
        const parsed = JSON.parse(saved);
        if (!parsed || typeof parsed !== "object") {
          return { ...CONFIG.DEFAULT_HOTKEYS };
        }

        const hasLegacyExtract = Object.prototype.hasOwnProperty.call(
          parsed,
          "extract"
        );
        const hasSalvage = Object.prototype.hasOwnProperty.call(parsed, "salvage");
        const legacySalvageHotkey = parsed?.salvage ?? parsed?.extract;
        const normalized = {
          enhance: Utils.normalizeHotkey(
            parsed?.enhance,
            CONFIG.DEFAULT_HOTKEYS.enhance
          ),
          salvage: Utils.normalizeHotkey(
            legacySalvageHotkey,
            CONFIG.DEFAULT_HOTKEYS.salvage
          ),
          gui: Utils.normalizeHotkey(parsed?.gui, CONFIG.DEFAULT_HOTKEYS.gui),
        };

        if (hasLegacyExtract && !hasSalvage) {
          Storage.setHotkeys(normalized);
        }

        return normalized;
      } catch (error) {
        return { ...CONFIG.DEFAULT_HOTKEYS };
      }
    },

    setHotkeys(hotkeys) {
      const normalized = {
        enhance: Utils.normalizeHotkey(
          hotkeys?.enhance,
          CONFIG.DEFAULT_HOTKEYS.enhance
        ),
        salvage: Utils.normalizeHotkey(
          hotkeys?.salvage,
          CONFIG.DEFAULT_HOTKEYS.salvage
        ),
        gui: Utils.normalizeHotkey(hotkeys?.gui, CONFIG.DEFAULT_HOTKEYS.gui),
      };

      window.localStorage.setItem(
        Storage.getHotkeysKey(),
        JSON.stringify(normalized)
      );

      return normalized;
    },

    getGuiPosition() {
      const saved = window.localStorage.getItem(Storage.getGuiPositionKey());
      if (!saved) {
        return { ...CONFIG.DEFAULT_BUTTON_POSITION };
      }

      try {
        const parsed = JSON.parse(saved);
        return {
          left:
            typeof parsed?.left === "number"
              ? parsed.left
              : CONFIG.DEFAULT_BUTTON_POSITION.left,
          top:
            typeof parsed?.top === "number"
              ? parsed.top
              : CONFIG.DEFAULT_BUTTON_POSITION.top,
          right:
            typeof parsed?.right === "number"
              ? parsed.right
              : CONFIG.DEFAULT_BUTTON_POSITION.right,
        };
      } catch (error) {
        return { ...CONFIG.DEFAULT_BUTTON_POSITION };
      }
    },

    setGuiPosition(position) {
      const normalized = {
        left:
          typeof position?.left === "number" ? Math.round(position.left) : null,
        top:
          typeof position?.top === "number"
            ? Math.round(position.top)
            : CONFIG.DEFAULT_BUTTON_POSITION.top,
        right:
          typeof position?.right === "number"
            ? Math.round(position.right)
            : CONFIG.DEFAULT_BUTTON_POSITION.right,
      };

      window.localStorage.setItem(
        Storage.getGuiPositionKey(),
        JSON.stringify(normalized)
      );

      return normalized;
    },

    getPanelPosition() {
      const saved = window.localStorage.getItem(Storage.getPanelPositionKey());
      if (!saved) {
        return { ...CONFIG.DEFAULT_PANEL_POSITION };
      }

      try {
        const parsed = JSON.parse(saved);
        return {
          left:
            typeof parsed?.left === "number"
              ? parsed.left
              : CONFIG.DEFAULT_PANEL_POSITION.left,
          top:
            typeof parsed?.top === "number"
              ? parsed.top
              : CONFIG.DEFAULT_PANEL_POSITION.top,
          right:
            typeof parsed?.right === "number"
              ? parsed.right
              : CONFIG.DEFAULT_PANEL_POSITION.right,
        };
      } catch (error) {
        return { ...CONFIG.DEFAULT_PANEL_POSITION };
      }
    },

    setPanelPosition(position) {
      const normalized = {
        left:
          typeof position?.left === "number" ? Math.round(position.left) : null,
        top:
          typeof position?.top === "number"
            ? Math.round(position.top)
            : CONFIG.DEFAULT_PANEL_POSITION.top,
        right:
          typeof position?.right === "number"
            ? Math.round(position.right)
            : CONFIG.DEFAULT_PANEL_POSITION.right,
      };

      window.localStorage.setItem(
        Storage.getPanelPositionKey(),
        JSON.stringify(normalized)
      );

      return normalized;
    },

    getWidgetSlot() {
      const saved = window.localStorage.getItem(Storage.getWidgetSlotKey());
      if (!saved) return null;

      try {
        const parsed = JSON.parse(saved);
        const widgetPos = parsed?.widgetPos === "top-right" ? "top-right" : "top-left";
        const slot = Math.max(0, Math.floor(Utils.toNumber(parsed?.slot, 0)));
        const widgetIndex = Math.max(0, Math.floor(Utils.toNumber(parsed?.widgetIndex, slot)));

        return {
          widgetPos,
          slot,
          widgetIndex,
        };
      } catch (error) {
        return null;
      }
    },

    setWidgetSlot(slotConfig) {
      const normalized = {
        widgetPos: slotConfig?.widgetPos === "top-right" ? "top-right" : "top-left",
        slot: Math.max(0, Math.floor(Utils.toNumber(slotConfig?.slot, 0))),
        widgetIndex: Math.max(
          0,
          Math.floor(Utils.toNumber(slotConfig?.widgetIndex, slotConfig?.slot ?? 0))
        ),
      };

      window.localStorage.setItem(
        Storage.getWidgetSlotKey(),
        JSON.stringify(normalized)
      );

      return normalized;
    },

    getAutoSettings() {
      const saved = window.localStorage.getItem(Storage.getAutoSettingsKey());
      if (!saved) {
        return { ...CONFIG.DEFAULT_AUTO_SETTINGS };
      }

      try {
        const parsed = JSON.parse(saved);
        return {
          enabled: Boolean(parsed?.enabled),
          minFreeSlots: Utils.clamp(
            Math.round(
              Utils.toNumber(
                parsed?.minFreeSlots,
                CONFIG.DEFAULT_AUTO_SETTINGS.minFreeSlots
              )
            ),
            CONFIG.AUTO_MIN_FREE_SLOTS_RANGE.min,
            CONFIG.AUTO_MIN_FREE_SLOTS_RANGE.max
          ),
        };
      } catch (error) {
        return { ...CONFIG.DEFAULT_AUTO_SETTINGS };
      }
    },

    setAutoSettings(settings) {
      const normalized = {
        enabled: Boolean(settings?.enabled),
        minFreeSlots: Utils.clamp(
          Math.round(
            Utils.toNumber(
              settings?.minFreeSlots,
              CONFIG.DEFAULT_AUTO_SETTINGS.minFreeSlots
            )
          ),
          CONFIG.AUTO_MIN_FREE_SLOTS_RANGE.min,
          CONFIG.AUTO_MIN_FREE_SLOTS_RANGE.max
        ),
      };

      window.localStorage.setItem(
        Storage.getAutoSettingsKey(),
        JSON.stringify(normalized)
      );

      return normalized;
    },

    getBoundSettings() {
      const saved = window.localStorage.getItem(Storage.getBoundSettingsKey());
      if (!saved) {
        return { ...CONFIG.DEFAULT_BOUND_SETTINGS };
      }

      try {
        const parsed = JSON.parse(saved);
        return {
          allowSoulbound: Boolean(parsed?.allowSoulbound),
          allowPermbound: Boolean(parsed?.allowPermbound),
        };
      } catch (error) {
        return { ...CONFIG.DEFAULT_BOUND_SETTINGS };
      }
    },

    setBoundSettings(settings) {
      const normalized = {
        allowSoulbound: Boolean(settings?.allowSoulbound),
        allowPermbound: Boolean(settings?.allowPermbound),
      };

      window.localStorage.setItem(
        Storage.getBoundSettingsKey(),
        JSON.stringify(normalized)
      );

      return normalized;
    },

    getMode() {
      const saved = window.localStorage.getItem(Storage.getModeKey());
      if (!saved) {
        return CONFIG.DEFAULT_MODE;
      }

      if (saved === "extraction") {
        return "salvage";
      }

      return CONFIG.AVAILABLE_MODES.includes(saved)
        ? saved
        : CONFIG.DEFAULT_MODE;
    },

    setMode(mode) {
      const normalized = CONFIG.AVAILABLE_MODES.includes(mode)
        ? mode
        : CONFIG.DEFAULT_MODE;

      window.localStorage.setItem(Storage.getModeKey(), normalized);
      return normalized;
    },

    getEnhanceCounter() {
      const saved = window.localStorage.getItem(Storage.getEnhanceCounterKey());
      const legacySaved = window.localStorage.getItem(
        Storage.getLegacyEnhanceCounterKey()
      );
      const valueToRead = saved || legacySaved;
      if (!valueToRead) return null;

      try {
        const parsedPayload = JSON.parse(valueToRead);
        const savedText = String(parsedPayload?.text || "").trim();
        const savedAt = Utils.toNumber(parsedPayload?.savedAt, NaN);

        if (!savedText || !Number.isFinite(savedAt)) {
          window.localStorage.removeItem(Storage.getEnhanceCounterKey());
          window.localStorage.removeItem(Storage.getLegacyEnhanceCounterKey());
          return null;
        }

        const currentCycleKey = Utils.getDailyResetCycleKey();
        const savedCycleKey = Utils.getDailyResetCycleKey(savedAt);

        if (!currentCycleKey || !savedCycleKey || currentCycleKey !== savedCycleKey) {
          window.localStorage.removeItem(Storage.getEnhanceCounterKey());
          window.localStorage.removeItem(Storage.getLegacyEnhanceCounterKey());
          return null;
        }

        const parsedCounter = Utils.parseEnhanceCounter(savedText);

        if (parsedCounter && !saved && legacySaved) {
          Storage.setEnhanceCounter(parsedCounter.text);
        }

        return parsedCounter ? parsedCounter.text : null;
      } catch (error) {
        window.localStorage.removeItem(Storage.getEnhanceCounterKey());
        window.localStorage.removeItem(Storage.getLegacyEnhanceCounterKey());
        return null;
      }
    },

    setEnhanceCounter(counterText) {
      if (!counterText) return;
      const payload = {
        text: String(counterText),
        savedAt: Date.now(),
      };

      window.localStorage.setItem(
        Storage.getEnhanceCounterKey(),
        JSON.stringify(payload)
      );
    },

    getDailyEnhancePoints() {
      const saved = window.localStorage.getItem(Storage.getDailyEnhancePointsKey());
      const legacySaved = window.localStorage.getItem(
        Storage.getLegacyDailyEnhancePointsKey()
      );
      const valueToRead = saved || legacySaved;
      if (!valueToRead) return CONFIG.DAILY_POINTS_DEFAULT;

      try {
        const payload = JSON.parse(valueToRead);
        const points = Math.max(0, Math.floor(Utils.toNumber(payload?.points, 0)));
        const savedAt = Utils.toNumber(payload?.savedAt, NaN);
        const payloadCycleKey = String(payload?.cycleKey || "").trim() || null;
        const currentCycleKey = Utils.getDailyResetCycleKey();

        if (!currentCycleKey) {
          window.localStorage.removeItem(Storage.getDailyEnhancePointsKey());
          window.localStorage.removeItem(Storage.getLegacyDailyEnhancePointsKey());
          return CONFIG.DAILY_POINTS_DEFAULT;
        }

        let savedCycleKey = payloadCycleKey;
        if (!savedCycleKey && Number.isFinite(savedAt)) {
          savedCycleKey = Utils.getDailyResetCycleKey(savedAt);
        }

        if (!savedCycleKey) {
          window.localStorage.removeItem(Storage.getDailyEnhancePointsKey());
          window.localStorage.removeItem(Storage.getLegacyDailyEnhancePointsKey());
          return CONFIG.DAILY_POINTS_DEFAULT;
        }

        if (!currentCycleKey || !savedCycleKey || currentCycleKey !== savedCycleKey) {
          window.localStorage.removeItem(Storage.getDailyEnhancePointsKey());
          window.localStorage.removeItem(Storage.getLegacyDailyEnhancePointsKey());
          return CONFIG.DAILY_POINTS_DEFAULT;
        }

        if (!saved && legacySaved) {
          Storage.setDailyEnhancePoints(points);
        } else if (!payloadCycleKey) {
          Storage.setDailyEnhancePoints(points);
        }

        return points;
      } catch (error) {
        window.localStorage.removeItem(Storage.getDailyEnhancePointsKey());
        window.localStorage.removeItem(Storage.getLegacyDailyEnhancePointsKey());
        return CONFIG.DAILY_POINTS_DEFAULT;
      }
    },

    setDailyEnhancePoints(points) {
      const normalizedPoints = Math.max(0, Math.floor(Utils.toNumber(points, 0)));
      const cycleKey = Utils.getDailyResetCycleKey();

      if (!cycleKey) {
        return normalizedPoints;
      }

      window.localStorage.setItem(
        Storage.getDailyEnhancePointsKey(),
        JSON.stringify({
          points: normalizedPoints,
          savedAt: Date.now(),
          cycleKey,
        })
      );

      return normalizedPoints;
    },

    addDailyEnhancePoints(pointsToAdd) {
      const delta = Math.floor(Utils.toNumber(pointsToAdd, 0));
      if (!Number.isFinite(delta) || delta <= 0) {
        return Storage.getDailyEnhancePoints();
      }

      const current = Storage.getDailyEnhancePoints();
      return Storage.setDailyEnhancePoints(current + delta);
    },

    getLauncherVisibility() {
      const saved = window.localStorage.getItem(Storage.getLauncherVisibilityKey());
      if (saved === null) {
        // Domyślnie launcher jest widoczny (pierwszy raz)
        return true;
      }
      return saved === "true";
    },

    setLauncherVisibility(isVisible) {
      window.localStorage.setItem(
        Storage.getLauncherVisibilityKey(),
        String(Boolean(isVisible))
      );
      return Boolean(isVisible);
    },
  };

  const EnhancementApi = {
    setEnhancedItem(itemId) {
      return new Promise((resolve) => {
        _g(`enhancement&action=status&item=${itemId}`, (data) => {
          resolve(data);
        });
      });
    },

    setReagents(itemId, reagentIds) {
      const reagents = reagentIds.join(",");
      return new Promise((resolve) => {
        _g(
          `enhancement&action=progress_preview&item=${itemId}&ingredients=${reagents}`,
          (data) => {
            resolve(data);
          }
        );
      });
    },

    enhanceItem(itemId, reagentIds) {
      if (!itemId || !reagentIds) return;
      const reagents = reagentIds.join(",");

      return new Promise((resolve) => {
        _g(
          `enhancement&action=progress&item=${itemId}&ingredients=${reagents}`,
          (data) => {
            resolve(data);
          }
        );
      });
    },
  };

  const SalvageApi = {
    clickNode(node) {
      if (!node) return false;
      const eventInit = { bubbles: true, cancelable: true };
      node.dispatchEvent(new MouseEvent("mousedown", eventInit));
      node.dispatchEvent(new MouseEvent("mouseup", eventInit));
      node.dispatchEvent(new MouseEvent("click", eventInit));
      return true;
    },

    async waitForRemovedCount(itemIds = [], attempts = 12, delay = 110) {
      let removedCount = 0;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        await Utils.sleep(delay);
        removedCount = itemIds.reduce(
          (acc, id) => acc + (Engine.items.getItemById(id) ? 0 : 1),
          0
        );
        if (removedCount > 0) break;
      }
      return removedCount;
    },

    async runDirectSalvageBatch(itemIds = []) {
      const availableItemIds = itemIds.filter((itemId) =>
        Boolean(Engine.items.getItemById(itemId))
      );
      if (availableItemIds.length === 0) return 0;
      if (typeof _g !== "function") return 0;

      const selectedItems = availableItemIds.join(",");

      await new Promise((resolve) => {
        _g(`salvager&action=salvage&selectedItems=${selectedItems}`, () => {
          resolve();
        });
      });

      return SalvageApi.waitForRemovedCount(availableItemIds, 14, 90);
    },

    async submitAndConfirmSalvage() {
      const submitButton =
        document.querySelector(".salvage__submit .button.small.green") ||
        document.querySelector(".salvage__submit .button");
      if (!SalvageApi.clickNode(submitButton)) return false;

      for (let attempt = 0; attempt < 12; attempt += 1) {
        await Utils.sleep(80);
        const confirmButton =
          document.querySelector(
            ".window-controlls .button.small.alert-accept-hotkey"
          ) ||
          document.querySelector(".window-controlls .alert-accept-hotkey");
        if (!confirmButton) continue;
        SalvageApi.clickNode(confirmButton);
        return true;
      }

      return false;
    },

    async runUiSalvagePass(itemIds = []) {
      const passItems = itemIds.filter((itemId) => Boolean(Engine.items.getItemById(itemId)));
      if (passItems.length === 0) return 0;

      const tabReady = await Ui.ensureCraftingModeTab();
      if (!tabReady) return 0;

      for (const itemId of passItems) {
        const itemNode = document.querySelector(`.item-id-${itemId}`);
        if (!itemNode) continue;
        SalvageApi.clickNode(itemNode);
        await Utils.sleep(95);
      }

      await Utils.sleep(230);

      const confirmed = await SalvageApi.submitAndConfirmSalvage();
      if (!confirmed) return 0;

      const removedInPass = await SalvageApi.waitForRemovedCount(passItems, 16, 120);

      for (let attempt = 0; attempt < 25; attempt += 1) {
        await Utils.sleep(100);
        const stillActive = document.querySelector(".salvage__submit .button.small.green");
        if (!stillActive) break;
      }

      return removedInPass;
    },

    async salvageItemsBatchThroughUi(itemIds = []) {
      const availableItemIds = itemIds.filter((itemId) =>
        Boolean(Engine.items.getItemById(itemId))
      );
      if (availableItemIds.length === 0) return 0;

      const directRemoved = await SalvageApi.runDirectSalvageBatch(
        availableItemIds
      );
      if (directRemoved > 0) {
        return directRemoved;
      }

      let removedTotal = 0;
      let pendingItemIds = [...availableItemIds];
      let noProgressPasses = 0;
      let adaptiveChunkSize = Math.min(12, pendingItemIds.length);

      for (let pass = 0; pass < 50; pass += 1) {
        pendingItemIds = pendingItemIds.filter((id) => Boolean(Engine.items.getItemById(id)));
        if (pendingItemIds.length === 0) break;

        const currentChunkSize = Math.max(1, Math.min(adaptiveChunkSize, pendingItemIds.length));
        const passItemIds = pendingItemIds.slice(0, currentChunkSize);
        const removedInPass = await SalvageApi.runUiSalvagePass(passItemIds);

        pendingItemIds = pendingItemIds.filter((id) => Boolean(Engine.items.getItemById(id)));
        removedTotal += removedInPass;

        if (removedInPass <= 0) {
          noProgressPasses += 1;
          adaptiveChunkSize = Math.max(1, Math.floor(currentChunkSize / 2));
        } else {
          noProgressPasses = 0;

          if (removedInPass < passItemIds.length) {
            adaptiveChunkSize = Math.max(1, Math.floor(currentChunkSize / 2));
          } else if (currentChunkSize < 12) {
            adaptiveChunkSize = Math.min(12, currentChunkSize + 1);
          }
        }

        if (noProgressPasses >= 6) break;
      }

      pendingItemIds = pendingItemIds.filter((id) => Boolean(Engine.items.getItemById(id)));
      if (pendingItemIds.length > 0) {
        for (const itemId of pendingItemIds) {
          if (!Engine.items.getItemById(itemId)) continue;

          const removedSingle = await SalvageApi.runUiSalvagePass([itemId]);
          removedTotal += removedSingle;

          if (!Engine.items.getItemById(itemId)) {
            continue;
          }

          const retryRemovedSingle = await SalvageApi.runUiSalvagePass([itemId]);
          removedTotal += retryRemovedSingle;
        }
      }

      return removedTotal;
    },
  };

  const Inventory = {
    isTruthyStatValue(value) {
      if (value === undefined || value === null) return false;
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value > 0;
      const normalized = String(value).trim().toLowerCase();
      if (!normalized) return false;
      return !["0", "false", "no", "none", "null", "undefined"].includes(
        normalized
      );
    },

    isExplicitFalseStatValue(value) {
      if (value === undefined || value === null) return false;
      if (typeof value === "boolean") return value === false;
      if (typeof value === "number") return value === 0;

      const normalized = Utils.normalizeText(String(value).trim());
      if (!normalized) return false;

      return ["0", "false", "no", "none", "null", "undefined", "off", "nie", "brak"].includes(
        normalized
      );
    },

    readBindState(item) {
      const stats = item?._cachedStats || {};
      const itemNode = document.querySelector(`.item-id-${item?.id}`);
      const domBindText = Utils.normalizeText(
        [
          itemNode?.getAttribute("data-tip"),
          itemNode?.getAttribute("tip"),
          itemNode?.getAttribute("data-stats"),
          itemNode?.getAttribute("data-item-tip"),
          itemNode?.getAttribute("data-hover"),
          item?.stat,
          item?.stats,
          item?.tip,
          item?.tooltip,
          item?.desc,
          item?.description,
        ]
          .filter((value) => value !== undefined && value !== null)
          .join(" | ")
      );
      const statsSerialized = Utils.normalizeText(JSON.stringify(stats));
      const bindParts = [
        stats.bind,
        stats.bound,
        stats.binds,
        stats.bound_to,
        stats.bound_type,
        stats.bind_type,
        stats.description,
      ]
        .filter((value) => value !== undefined && value !== null)
        .map((value) => Utils.normalizeText(value));

      const allStatsText = Utils.normalizeText(
        Object.values(stats)
          .filter((value) => typeof value === "string")
          .join(" | ")
      );

      const bindText = `${bindParts.join(" | ")} | ${allStatsText} | ${domBindText}`;
      const bindRaw = `${bindText} | ${statsSerialized}`;

      const hasNegation =
        bindText.includes("niezwiaz") || bindText.includes("unbound");
      const hasAnyBindKeyword =
        bindText.includes("bind") ||
        bindText.includes("bound") ||
        bindText.includes("zwiaz") ||
        bindText.includes("wiaze po") ||
        bindText.includes("wiaze sie");

      const isBindsByBind =
        !hasNegation &&
        (bindText.includes("binds") ||
          bindText.includes("wiaze po zalozeniu") ||
          bindText.includes("wiaze po") ||
          bindText.includes("wiaze sie po") ||
          bindText.includes("bind on equip"));

      const isSoulboundByBind =
        !hasNegation &&
        (bindText.includes("soul") ||
          bindText.includes("zwiazany z wlascicielem") ||
          bindText.includes("zwiazany z graczem") ||
          bindText.includes("bound to owner") ||
          bindText.includes("ownerbound"));

      const isPermboundByBind =
        !hasNegation &&
        (bindText.includes("perm") ||
          bindText.includes("zwiazany na stale") ||
          bindText.includes("zwiazany z wlascicielem na stale") ||
          bindText.includes("bound forever") ||
          bindText.includes("permanent bound"));

      const isSoulboundByFlags = [
        stats.soulbound,
        stats.soul_bound,
        stats.bound_to_owner,
      ].some((value) => Inventory.isTruthyStatValue(value));

      const isPermboundByFlags = [
        stats.permbound,
        stats.perm_bound,
        stats.permanent_bound,
      ].some((value) => Inventory.isTruthyStatValue(value));

      const isBindsByFlags = [
        stats.binds,
        stats.bind_on_equip,
        stats.bindOnEquip,
      ].some((value) => Inventory.isTruthyStatValue(value));

      const isGenericBoundByFlags = [
        stats.bound,
        stats.bind,
        stats.binded,
        stats.locked,
      ].some((value) => Inventory.isTruthyStatValue(value));

      const explicitBindFlags = [
        stats.bound,
        stats.bind,
        stats.binded,
        stats.locked,
        stats.soulbound,
        stats.soul_bound,
        stats.bound_to_owner,
        stats.permbound,
        stats.perm_bound,
        stats.permanent_bound,
        stats.binds,
        stats.bind_on_equip,
        stats.bindOnEquip,
      ].filter((value) => value !== undefined && value !== null);

      const hasAnyExplicitBindFlag = explicitBindFlags.length > 0;
      const hasExplicitBindTrue = explicitBindFlags.some((value) =>
        Inventory.isTruthyStatValue(value)
      );
      const hasExplicitBindFalse = explicitBindFlags.some((value) =>
        Inventory.isExplicitFalseStatValue(value)
      );

      const isDefinitelyUnboundByText =
        hasNegation ||
        bindRaw.includes("brak wzmianki odnosnie wiazania") ||
        bindRaw.includes("nie jest zwiazany") ||
        bindRaw.includes("not bound");

      const hasExplicitUnboundFlags =
        hasAnyExplicitBindFlag && !hasExplicitBindTrue && hasExplicitBindFalse;

      const isExplicitlySafeUnbound =
        isDefinitelyUnboundByText || hasExplicitUnboundFlags;

      const isUnknownBound =
        !isSoulboundByBind &&
        !isPermboundByBind &&
        !isSoulboundByFlags &&
        !isPermboundByFlags &&
        !hasNegation &&
        !isExplicitlySafeUnbound &&
        (isGenericBoundByFlags || bindText.includes("zwiaz") || bindText.includes("bound"));

      const isSoulbound = isSoulboundByBind || isSoulboundByFlags;
      const isPermbound = isPermboundByBind || isPermboundByFlags;
      const isBinds = isBindsByBind || isBindsByFlags;

      let state = "unbound";
      if (isPermbound) {
        state = "permbound";
      } else if (isSoulbound) {
        state = "soulbound";
      } else if (isBinds) {
        state = "binds";
      } else if (isUnknownBound) {
        state = "unknown-bound";
      }

      return {
        isSoulbound,
        isPermbound,
        isBinds,
        isUnknownBound,
        hasAnyBindKeyword,
        hasNegation,
        isDefinitelyUnboundByText,
        hasExplicitUnboundFlags,
        isExplicitlySafeUnbound,
        state,
      };
    },

    isAlreadyEnhanced(item) {
      const stats = item?._cachedStats || {};

      const numericLevel = Utils.toNumber(
        stats.enhancement_upgrade_lvl ??
          stats.enhancementUpgradeLvl ??
          stats.upgrade_lvl ??
          stats.upgradeLevel,
        0
      );

      if (numericLevel > 0) {
        return true;
      }

      const enhancementFlags = [
        stats.enhanced,
        stats.is_enhanced,
        stats.isEnhanced,
        stats.was_enhanced,
        stats.wasEnhanced,
      ];

      return enhancementFlags.some((value) => Inventory.isTruthyStatValue(value));
    },

    canUseAsReagent(item, allowedRarities) {
      const itemRarity = item?._cachedStats?.rarity;
      const isAllowedRarity = allowedRarities.includes(itemRarity);
      const isAllowedType = ALLOWED_ITEM_TYPES.includes(item.cl);
      const canBeUsed = !item._cachedStats.hasOwnProperty("artisan_worthless");
      const isUpgraded = Inventory.isAlreadyEnhanced(item);

      const bindState = Inventory.readBindState(item);
      const boundSettings =
        state.boundSettings ||
        Storage.getBoundSettings() ||
        CONFIG.DEFAULT_BOUND_SETTINGS;
      const strictNoBoundMode =
        !boundSettings.allowSoulbound && !boundSettings.allowPermbound;
      const isHeroic = itemRarity === "heroic";
      const isBoundBySoulOrPerm =
        bindState.state === "soulbound" || bindState.state === "permbound";

      if (isHeroic && isBoundBySoulOrPerm) {
        return false;
      }

      const canUseBoundByRarity = ["common", "unique"].includes(itemRarity);

      if (
        strictNoBoundMode &&
        ["soulbound", "permbound", "unknown-bound"].includes(bindState.state)
      ) {
        return false;
      }

      if (bindState.state === "soulbound" && (!boundSettings.allowSoulbound || !canUseBoundByRarity)) {
        return false;
      }

      if (bindState.state === "permbound" && (!boundSettings.allowPermbound || !canUseBoundByRarity)) {
        return false;
      }

      if (
        bindState.state === "unknown-bound" &&
        !boundSettings.allowSoulbound &&
        !boundSettings.allowPermbound
      ) {
        return false;
      }

      return (
        isAllowedRarity &&
        isAllowedType &&
        itemRarity &&
        canBeUsed &&
        !isUpgraded
      );
    },

    getReagents() {
      const allowedRarities = Storage.getAllowedRarities();
      const reagents = Engine.items.fetchLocationItems("g").reduce((acc, item) => {
        if (Inventory.canUseAsReagent(item, allowedRarities)) {
          acc.push(item.id);
        }
        return acc;
      }, []);

      return [...new Set(reagents)];
    },

    getItemsForSalvage() {
      return Inventory.getReagents();
    },

    getFreeSlotsInfo() {
      const candidates = [];
      const EXCLUDED_BAG_SLOT_SELECTOR = ".bag-4-slot";
      const EXCLUDED_BAG_SELECTOR = '[data-bag="26"]';
      const isInExcludedBagSlot = (node) =>
        Boolean(
          node?.closest?.(EXCLUDED_BAG_SLOT_SELECTOR) ||
            node?.closest?.(EXCLUDED_BAG_SELECTOR)
        );

      const addCandidate = (freeSlots, source, extra = {}) => {
        if (typeof freeSlots !== "number" || !Number.isFinite(freeSlots)) return;
        if (freeSlots < 0) return;
        candidates.push({ freeSlots, source, ...extra });
      };

      let directFree = null;
      if (
        window.Engine?.items?.getFreeSlots &&
        typeof window.Engine.items.getFreeSlots === "function"
      ) {
        try {
          directFree = window.Engine.items.getFreeSlots("g");
        } catch (error) {
          directFree = null;
        }

        if (!(typeof directFree === "number" && directFree >= 0)) {
          try {
            directFree = window.Engine.items.getFreeSlots();
          } catch (error) {
            directFree = null;
          }
        }
      }

      const excludedBagEmptySlots = [
        ...document.querySelectorAll(`${EXCLUDED_BAG_SELECTOR} .item.empty`),
        ...document.querySelectorAll(`${EXCLUDED_BAG_SELECTOR} .slot.empty`),
      ].length;

      const bagNodes = [...document.querySelectorAll(".item.bag")].filter(
        (node) => !isInExcludedBagSlot(node)
      );
      if (bagNodes.length > 0) {
        let hasParsedBagAmount = false;
        const freeFromBags = bagNodes.reduce((sum, node) => {
          const rawAmount = node.querySelector(".amount")?.textContent || "";
          const match = String(rawAmount).match(/\d+/);
          if (!match) return sum;

          hasParsedBagAmount = true;
          return sum + Utils.toNumber(match[0], 0);
        }, 0);

        if (hasParsedBagAmount) {
          addCandidate(freeFromBags, "DOM .item.bag .amount", {
            totalSlots: null,
            occupiedSlots: null,
            bagCount: bagNodes.length,
          });
        }
      }

      const emptySelectors = [
        ".inventory .item.empty",
        ".inventory .slot.empty",
        ".backpack .item.empty",
        ".backpack .slot.empty",
        ".bag .item.empty",
        ".bag .slot.empty",
        ".scroll-pane .item.empty",
        ".scroll-pane .slot.empty",
      ];

      const emptyCount = emptySelectors
        .map(
          (selector) =>
            [...document.querySelectorAll(selector)].filter(
              (node) => !isInExcludedBagSlot(node)
            ).length
        )
        .reduce((sum, count) => sum + count, 0);

      if (emptyCount > 0) {
        addCandidate(emptyCount, "DOM .empty");
      }

      const inventoryRoot =
        document.querySelector(".inventory") ||
        document.querySelector(".backpack") ||
        document.querySelector(".bag") ||
        document.querySelector(".scroll-pane");

      if (inventoryRoot) {
        const totalSlots = [...inventoryRoot.querySelectorAll(".item, .slot")].filter(
          (node) => !isInExcludedBagSlot(node)
        ).length;
        const occupiedSlots = Engine.items.fetchLocationItems("g").length;

        if (totalSlots > 0 && totalSlots >= occupiedSlots) {
          addCandidate(totalSlots - occupiedSlots, "DOM total - occupied", {
            totalSlots,
            occupiedSlots,
          });
        }

        const allItemNodes = [...inventoryRoot.querySelectorAll(".item")].filter(
          (node) => !isInExcludedBagSlot(node)
        );
        const occupiedFromDom = allItemNodes.filter((node) => {
          const className = typeof node.className === "string" ? node.className : "";
          return /item-id-\d+/.test(className);
        }).length;

        if (allItemNodes.length > 0 && allItemNodes.length >= occupiedFromDom) {
          addCandidate(allItemNodes.length - occupiedFromDom, "DOM .item - .item-id-*", {
            totalSlots: allItemNodes.length,
            occupiedSlots: occupiedFromDom,
          });
        }
      }

      const scrollPane = document.querySelector(".scroll-pane");
      if (scrollPane) {
        const slotNodes = [...scrollPane.querySelectorAll(".item, .slot")].filter(
          (node) => !isInExcludedBagSlot(node)
        );
        if (slotNodes.length > 0) {
          const occupiedInScrollPane = [...slotNodes].filter((node) => {
            const className = typeof node.className === "string" ? node.className : "";
            return /item-id-\d+/.test(className);
          }).length;

          addCandidate(
            slotNodes.length - occupiedInScrollPane,
            "scroll-pane slots - item-id-*",
            {
              totalSlots: slotNodes.length,
              occupiedSlots: occupiedInScrollPane,
            }
          );
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.freeSlots - a.freeSlots);
        return candidates[0];
      }

      if (typeof directFree === "number" && Number.isFinite(directFree)) {
        const adjustedDirectFree = Math.max(0, directFree - excludedBagEmptySlots);
        addCandidate(adjustedDirectFree, "Engine.items.getFreeSlots - excluded bag 26", {
          excludedBagEmptySlots,
        });
        return candidates[0];
      }

      return {
        freeSlots: null,
        source: "unknown",
      };
    },

    getFreeSlots() {
      return Inventory.getFreeSlotsInfo().freeSlots;
    },

  };

  const Ui = {
    setupCss() {
      const css = `
      :root {
        --ql-bg: rgba(13, 13, 15, 0.97);
        --ql-bg-soft: rgba(255, 255, 255, 0.04);
        --ql-bg-softer: rgba(255, 255, 255, 0.02);
        --ql-border: rgba(255, 255, 255, 0.08);
        --ql-border-strong: rgba(255, 255, 255, 0.14);
        --ql-text: #f2f2f3;
        --ql-text-dim: #9a9aa0;
        --ql-text-mute: #6b6b70;
        --ql-white-pill: #f4f4f5;
        --ql-white-pill-hover: #e4e4e7;
        --ql-black-on-white: #18181b;
        --ql-green: #4ade80;
        --ql-red: #f87171;
        --ql-blue: #60a5fa;
        --ql-orange: #fb923c;
        --ql-radius-sm: 6px;
        --ql-radius-md: 10px;
        --ql-radius-lg: 14px;
        --ql-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .upgrader-crafting-window {
        display: none !important;
      }
      .upgrader-crafting-window-offscreen {
        position: fixed !important;
        top: -9999px !important;
        left: -9999px !important;
        opacity: 0 !important;
      }
      .widget-button.widget-upgrader-addon {
        cursor: pointer;
        overflow: hidden;
        background: var(--ql-bg) !important;
        border-color: var(--ql-border-strong) !important;
      }
      .widget-button.widget-upgrader-addon::before {
        box-shadow: inset 0 0 0 1px var(--ql-border-strong) !important;
      }
      .widget-button.widget-upgrader-addon .icon.upgrader-widget-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        position: absolute !important;
        top: 2px !important;
        right: 2px !important;
        bottom: 2px !important;
        left: 2px !important;
        margin: 0 !important;
        box-sizing: border-box;
        width: auto !important;
        height: auto !important;
        padding: 0;
        overflow: hidden;
        border-radius: var(--ql-radius-sm);
        transform: none !important;
        font-weight: 600;
        font-size: 14px;
        color: var(--ql-text);
        background-image: url("https://micc.garmory-cdn.cloud/obrazki/npc/e2/trist2_wabicielka-1a.gif") !important;
        background-repeat: no-repeat !important;
        background-position: calc(50% + 2px) 50% !important;
        background-size: 94% 94% !important;
        background-origin: border-box !important;
        background-clip: border-box !important;
        image-rendering: auto;
      }
      .widget-button.widget-upgrader-addon.ui-draggable-dragging {
        z-index: 1000 !important;
      }
      .upgrader-launcher,
      .upgrader-launcher *,
      .upgrader-gui-panel,
      .upgrader-gui-panel *,
      .upgrader-label,
      .menu-item--yellow {
        font-family: var(--ql-font) !important;
      }
      .menu-item--yellow {
        background: var(--ql-white-pill) !important;
        color: var(--ql-black-on-white) !important;
        border-radius: var(--ql-radius-sm) !important;
        padding: 5px !important;
        font-weight: 600 !important;
      }
      .upgrader-label {
          position: absolute;
          top: 18px;
          left: 8px;
          height: 16px;
          width: 32px;
          text-align: center;
          color: var(--ql-green);
          pointer-events: none;
          text-shadow: -1px 0 black, 0 1px black, 1px 0 black, 0 -1px black;
          font-size: 0.75rem;
          font-weight: 700;
      }
          .upgrader-launcher {
            position: fixed;
            right: 16px;
            top: 150px;
            width: 146px;
            z-index: 12;
            border: 1px solid var(--ql-border);
            border-radius: var(--ql-radius-lg);
            background: var(--ql-bg);
            color: var(--ql-text);
            cursor: default;
            font-weight: 500;
            font-family: var(--ql-font);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
            user-select: none;
            padding: 8px;
            box-sizing: border-box;
          }
          .upgrader-launcher-title {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.6px;
            text-transform: uppercase;
            text-align: left;
            cursor: move;
            color: var(--ql-text-dim);
            margin-bottom: 6px;
          }
          .upgrader-launcher-counter {
            margin-top: 4px;
            margin-bottom: 3px;
            text-align: left;
            font-size: 11px;
            color: var(--ql-text-dim);
          }
          .upgrader-launcher-points {
            margin-bottom: 8px;
            text-align: left;
            font-size: 11px;
            color: var(--ql-text-dim);
          }
          .upgrader-launcher-mode {
            margin-bottom: 8px;
            text-align: left;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.4px;
            text-transform: uppercase;
          }
          .upgrader-launcher-mode--enhancement {
            color: var(--ql-blue);
          }
          .upgrader-launcher-mode--salvage {
            color: var(--ql-orange);
          }
          .upgrader-launcher-counter--good {
            color: var(--ql-green);
          }
          .upgrader-launcher-counter--mid {
            color: #eab308;
          }
          .upgrader-launcher-counter--low {
            color: var(--ql-red);
          }
          .upgrader-launcher-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
          }
          .upgrader-launcher-btn {
            border: 1px solid var(--ql-border);
            border-radius: 999px;
            background: var(--ql-bg-soft);
            color: var(--ql-text);
            height: 26px;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.2px;
            cursor: pointer;
            transition: background 0.15s ease, border-color 0.15s ease;
          }
          .upgrader-launcher-btn:hover {
            background: var(--ql-white-pill);
            color: var(--ql-black-on-white);
            border-color: var(--ql-white-pill);
          }
          .upgrader-gui-panel {
            position: fixed;
            right: 16px;
            top: 188px;
            width: 264px;
            z-index: 11;
            border: 1px solid var(--ql-border);
            border-radius: var(--ql-radius-lg);
            background: var(--ql-bg);
            backdrop-filter: blur(6px);
            color: var(--ql-text);
            padding: 10px;
            display: none;
            box-sizing: border-box;
            overflow: visible;
            user-select: none;
            font-family: var(--ql-font);
            cursor: default;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
          }
          .upgrader-gui-title {
            position: relative;
            display: flex;
            align-items: center;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.2px;
            margin-bottom: 8px;
            cursor: move;
            padding: 3px 24px 8px 2px;
            border-bottom: 1px solid var(--ql-border);
            color: var(--ql-text);
          }
          .upgrader-gui-close-btn {
            position: absolute;
            top: 0;
            right: 0;
            width: 20px;
            height: 20px;
            border: 1px solid var(--ql-border);
            border-radius: 999px;
            background: var(--ql-bg-soft);
            color: var(--ql-text-dim);
            font-size: 12px;
            font-weight: 700;
            line-height: 1;
            cursor: pointer;
            padding: 0;
            transition: background 0.15s ease, color 0.15s ease;
          }
          .upgrader-gui-close-btn:hover {
            background: var(--ql-white-pill);
            color: var(--ql-black-on-white);
          }
          .upgrader-gui-row {
            display: flex;
            gap: 6px;
            margin-top: 8px;
          }
          .upgrader-gui-btn {
            border: 1px solid var(--ql-border);
            border-radius: 999px;
            background: var(--ql-bg-soft);
            color: var(--ql-text);
            height: 28px;
            cursor: pointer;
          }
          .upgrader-gui-btn {
            padding: 0 10px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 700;
            flex: 1;
            transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
          }
          .upgrader-gui-btn:hover {
            background: var(--ql-white-pill);
            color: var(--ql-black-on-white);
            border-color: var(--ql-white-pill);
          }
            .upgrader-select-hint {
              margin-top: 8px;
              border: 1px solid var(--ql-border);
              border-radius: var(--ql-radius-md);
              padding: 8px;
              background: var(--ql-bg-softer);
              font-size: 10px;
              line-height: 1.4;
              color: var(--ql-text-dim);
            }
            .upgrader-selected-preview-wrap {
              margin-top: 8px;
              border: 1px solid var(--ql-border);
              border-radius: var(--ql-radius-md);
              padding: 8px;
              background: var(--ql-bg-softer);
            }
            .upgrader-selected-preview-box {
              min-height: 40px;
              display: flex;
              align-items: center;
              gap: 8px;
              position: relative;
            }
            .upgrader-selected-preview-item {
              width: 32px;
              height: 32px;
              position: relative !important;
              left: 0 !important;
              top: 0 !important;
              right: auto !important;
              bottom: auto !important;
              margin: 0 !important;
              transform: none !important;
              display: block !important;
              flex: 0 0 auto;
              overflow: hidden;
              border-radius: var(--ql-radius-sm);
            }
            .upgrader-selected-preview-item .highlight {
              position: absolute !important;
              top: 0 !important;
              left: 0 !important;
              width: 32px !important;
              height: 32px !important;
              pointer-events: none;
              z-index: 0;
            }
            .upgrader-selected-preview-icon {
              width: 32px;
              height: 32px;
              display: block;
              flex: 0 0 auto;
              image-rendering: auto;
              position: relative;
              z-index: 1;
            }
            .upgrader-selected-preview-text {
              font-size: 11px;
              font-weight: 500;
              color: var(--ql-text);
              word-break: break-word;
            }
            .upgrader-gui-rarity-wrap {
              margin-top: 8px;
              border: 1px solid var(--ql-border);
              border-radius: var(--ql-radius-md);
              padding: 8px;
              background: var(--ql-bg-softer);
            }
            .upgrader-mode-wrap {
              margin-top: 8px;
              border: 1px solid var(--ql-border);
              border-radius: var(--ql-radius-md);
              padding: 10px;
              background: var(--ql-bg-softer);
            }
            .upgrader-mode-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 10px;
            }
            .upgrader-mode-label {
              font-size: 11px;
              font-weight: 700;
              color: var(--ql-text-dim);
              letter-spacing: 0.3px;
              text-transform: uppercase;
            }
            .upgrader-mode-value {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              min-width: 96px;
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.3px;
            }
            .upgrader-mode-value--enhancement {
              color: var(--ql-blue);
            }
            .upgrader-mode-value--salvage {
              color: var(--ql-orange);
            }
            .upgrader-mode-switch {
              position: relative;
              display: inline-flex;
              width: 40px;
              height: 22px;
              cursor: pointer;
            }
            .upgrader-mode-switch input {
              opacity: 0;
              width: 0;
              height: 0;
            }
            .upgrader-mode-slider {
              position: absolute;
              inset: 0;
              border-radius: 999px;
              border: 1px solid var(--ql-border-strong);
              background: rgba(255, 255, 255, 0.08);
              box-sizing: border-box;
              overflow: hidden;
              transition: background 0.2s ease, border-color 0.2s ease;
            }
            .upgrader-mode-slider::before {
              content: "";
              position: absolute;
              width: 16px;
              height: 16px;
              left: 2px;
              top: 2px;
              border-radius: 50%;
              background: var(--ql-text-dim);
              transition: transform 0.2s ease, background 0.2s ease;
            }
            .upgrader-mode-switch input:checked + .upgrader-mode-slider {
              background: rgba(251, 146, 60, 0.16);
              border-color: rgba(251, 146, 60, 0.5);
            }
            .upgrader-mode-switch input:checked + .upgrader-mode-slider::before {
              transform: translateX(18px);
              background: var(--ql-orange);
            }
            .upgrader-gui-rarity-title {
              font-size: 11px;
              font-weight: 700;
              letter-spacing: 0.3px;
              text-transform: uppercase;
              margin-bottom: 6px;
              color: var(--ql-text-dim);
            }
            .upgrader-gui-rarity-list {
              display: flex;
              gap: 10px;
              flex-wrap: wrap;
            }
            .upgrader-gui-rarity-item {
              display: inline-flex;
              align-items: center;
              gap: 5px;
              font-size: 11px;
              color: var(--ql-text);
            }
            .upgrader-rarity-common {
              color: var(--ql-text-dim);
            }
            .upgrader-rarity-unique {
              color: #eab308;
            }
            .upgrader-rarity-heroic {
              color: var(--ql-blue);
            }
            .upgrader-bound-wrap {
              margin-top: 8px;
              border: 1px solid var(--ql-border);
              border-radius: var(--ql-radius-md);
              padding: 8px;
              background: var(--ql-bg-softer);
            }
            .upgrader-bound-item {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 10px;
              font-size: 11px;
              color: var(--ql-text);
              margin-bottom: 6px;
            }
            .upgrader-bound-item span:first-child {
              font-weight: 500;
            }
            .upgrader-bound-item:last-child {
              margin-bottom: 0;
            }
            .upgrader-bound-warning {
              margin-top: 4px;
              font-size: 10px;
              color: var(--ql-red);
              display: inline-flex;
              align-items: center;
              gap: 6px;
            }
            .upgrader-tooltip-trigger {
              position: relative;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 14px;
              height: 14px;
              border-radius: 50%;
              border: 1px solid var(--ql-border-strong);
              color: var(--ql-text-dim);
              font-size: 10px;
              line-height: 1;
              background: var(--ql-bg-soft);
              cursor: help;
            }
            .upgrader-tooltip-trigger[data-tooltip]:hover::after {
              content: attr(data-tooltip);
              position: absolute;
              left: 0;
              bottom: calc(100% + 6px);
              max-width: 220px;
              padding: 6px 8px;
              border-radius: var(--ql-radius-sm);
              border: 1px solid var(--ql-border);
              background: #0a0a0b;
              color: var(--ql-text);
              font-size: 10px;
              line-height: 1.35;
              white-space: normal;
              z-index: 15;
              box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
              pointer-events: none;
            }
            .upgrader-hotkeys-wrap {
              margin-top: 8px;
              border: 1px solid var(--ql-border);
              border-radius: var(--ql-radius-md);
              padding: 8px;
              background: var(--ql-bg-softer);
            }
            .upgrader-hotkeys-grid {
              display: grid;
              grid-template-columns: 1fr 38px;
              gap: 6px;
              align-items: center;
            }
            .upgrader-hotkeys-label {
              font-size: 11px;
              font-weight: 500;
              color: var(--ql-text-dim);
              align-self: center;
            }
            .upgrader-hotkeys-input {
              border: 1px solid var(--ql-border-strong);
              border-radius: var(--ql-radius-sm);
              background: var(--ql-bg-soft);
              color: var(--ql-text);
              height: 24px;
              text-align: center;
              cursor: pointer;
            }
            .upgrader-auto-wrap {
              margin-top: 8px;
              border: 1px solid var(--ql-border);
              border-radius: var(--ql-radius-md);
              padding: 8px;
              background: var(--ql-bg-softer);
            }
            .upgrader-auto-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 6px;
              margin-bottom: 8px;
              font-size: 11px;
              color: var(--ql-text);
            }
            .upgrader-auto-row label {
              font-weight: 500;
            }
            .upgrader-auto-slider {
              width: 100%;
              accent-color: var(--ql-text);
            }
            .upgrader-auto-slider:disabled {
              opacity: 0.4;
            }
            .upgrader-auto-info {
              margin-top: 4px;
              font-size: 10px;
              color: var(--ql-text-dim);
            }
            .upgrader-gui-panel input[type="checkbox"] {
              appearance: none;
              -webkit-appearance: none;
              width: 16px;
              height: 16px;
              border-radius: 4px;
              border: 1px solid var(--ql-border-strong);
              background: var(--ql-bg-soft);
              cursor: pointer;
              flex: 0 0 auto;
              position: relative;
              transition: background 0.15s ease, border-color 0.15s ease;
            }
            .upgrader-gui-panel input[type="checkbox"]:checked {
              background: var(--ql-white-pill);
              border-color: var(--ql-white-pill);
            }
            .upgrader-gui-panel input[type="checkbox"]:checked::after {
              content: "";
              position: absolute;
              left: 5px;
              top: 1px;
              width: 4px;
              height: 8px;
              border: solid var(--ql-black-on-white);
              border-width: 0 2px 2px 0;
              transform: rotate(45deg);
            }
    `;

      const style = document.createElement("style");
      style.appendChild(document.createTextNode(css));
      document.head.appendChild(style);
    },

    isCraftingWindowOpen() {
      const windowNode = Engine?.crafting?.window?.wnd?.$;
      if (!windowNode) return false;

      try {
        if (typeof windowNode.is === "function") {
          return windowNode.is(":visible");
        }

        const rawNode = windowNode[0];
        if (rawNode) {
          const computedStyle = window.getComputedStyle(rawNode);
          return (
            computedStyle.display !== "none" &&
            computedStyle.visibility !== "hidden" &&
            computedStyle.opacity !== "0"
          );
        }
      } catch (error) {
        return false;
      }

      return false;
    },

    prepareEnhancementWindow() {
      const wasOpenBeforeRun = Ui.isCraftingWindowOpen();
      const hideCssClass =
        state.mode === "salvage" ? null : "upgrader-crafting-window";

      if (!wasOpenBeforeRun) {
        if (hideCssClass) {
          Engine.crafting.window.wnd.$.addClass(hideCssClass);
        }
        Engine.interface.clickCrafting();
      } else {
        if (hideCssClass) {
          Engine.crafting.window.wnd.$.addClass(hideCssClass);
        }
      }

      Ui.ensureCraftingModeTab();

      return { wasOpenBeforeRun, hideCssClass };
    },

    async ensureCraftingModeTab() {
      if (state.mode !== "salvage") {
        return true;
      }

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const salvageTab =
          document.querySelector(
            '.one-item-on-divide-list.crafting-recipe-in-list[data-tab-id="salvage"]'
          ) ||
          document.querySelector(
            '.one-item-on-divide-list.crafting-recipe-in-list[data-tab-id="extraction"]'
          );

        if (!salvageTab) {
          await Utils.sleep(80);
          continue;
        }

        salvageTab.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true })
        );
        salvageTab.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, cancelable: true })
        );
        salvageTab.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );

        await Utils.sleep(90);

        const isActive =
          salvageTab.classList.contains("active") ||
          salvageTab.classList.contains("selected") ||
          salvageTab.classList.contains("crafting-recipe-in-list-active") ||
          salvageTab.getAttribute("aria-selected") === "true";

        if (isActive) {
          return true;
        }
      }

      return false;
    },

    restoreEnhancementWindow(session = {}) {
      const wasOpenBeforeRun = Boolean(session?.wasOpenBeforeRun);
      const hideCssClass = session?.hideCssClass || null;

      if (hideCssClass) {
        Engine.crafting.window.wnd.$.removeClass(hideCssClass);
      }

      if (!wasOpenBeforeRun && Ui.isCraftingWindowOpen()) {
        Engine.interface.clickCrafting();
      }
    },

    markItemAsUpgraded(prevId) {
      if (prevId) {
        $(`.item-id-${prevId}`).find(".upgrader-label").remove();
      }

      const upgradedItemId = Storage.getUpgradedItemId();
      if (!upgradedItemId) return;

      const upgradedItem = Engine.items.getItemById(upgradedItemId);
      if (!upgradedItem) return;

      $(`.item-id-${upgradedItemId}`).find(".upgrader-label").remove();

      const label = $(`<div class="upgrader-label">U</div>`);
      $(`.item-id-${upgradedItemId}`).append(label);
    },

    renderSelectedItemPreview() {
      const previewBox = document.getElementById("upgrader-selected-preview-box");
      const previewText = document.getElementById("upgrader-selected-preview-text");
      if (!previewBox || !previewText) return;

      previewBox.innerHTML = "";

      const selectedId = Storage.getUpgradedItemId();
      if (!selectedId) {
        previewText.textContent = "Brak wybranego przedmiotu";
        return;
      }

      const item = Engine.items.getItemById(selectedId);
      if (!item) {
        previewText.textContent = `Wybrany ID: ${selectedId} (poza plecakiem)`;
        return;
      }

      const sourceNode = document.querySelector(`.item-id-${selectedId}`);
      if (sourceNode) {
        const sourceCanvas = sourceNode.querySelector("canvas.icon.canvas-icon");
        const sourceHighlight = sourceNode.querySelector(".highlight");

        if (sourceCanvas) {
          const previewItem = document.createElement("div");
          previewItem.className = "upgrader-selected-preview-item item";

          const iconPreview = document.createElement("img");
          iconPreview.className = "upgrader-selected-preview-icon";
          iconPreview.alt = item.name || "Wybrany przedmiot";
          iconPreview.src = sourceCanvas.toDataURL("image/png");

          previewItem.appendChild(iconPreview);

          if (sourceHighlight) {
            const highlightPreview = sourceHighlight.cloneNode(true);
            const highlightStyles = window.getComputedStyle(sourceHighlight);

            highlightPreview.style.backgroundImage = highlightStyles.backgroundImage;
            highlightPreview.style.backgroundPosition = highlightStyles.backgroundPosition;
            highlightPreview.style.backgroundSize = highlightStyles.backgroundSize;
            highlightPreview.style.backgroundRepeat = highlightStyles.backgroundRepeat;

            previewItem.appendChild(highlightPreview);
          }

          previewBox.appendChild(previewItem);
        }
      }

      previewText.textContent = item.name;
    },

    clearUpgradedItem() {
      const previousId = Storage.getUpgradedItemId();
      Storage.setUpgradedItemId("");
      Ui.markItemAsUpgraded(previousId);
      Ui.renderSelectedItemPreview();
    },

    refreshEnhanceCounter() {
      const counterNode = document.getElementById("upgrader-launcher-counter");
      if (!counterNode) return;

      const source =
        document.querySelector(".enhance__counter") ||
        document.querySelector("span.enhance_counter") ||
        document.querySelector(".enhance_counter");
      const parsedFromDom = Utils.parseEnhanceCounter(source?.textContent?.trim());
      const cached = Storage.getEnhanceCounter();
      const parsedFromCache = Utils.parseEnhanceCounter(cached);
      const counter = parsedFromDom || parsedFromCache;

      counterNode.classList.remove(
        "upgrader-launcher-counter--good",
        "upgrader-launcher-counter--mid",
        "upgrader-launcher-counter--low"
      );

      if (!counter) {
        counterNode.textContent = "Limit: --/--";
        return;
      }

      state.enhanceCounter = counter.text;
      Storage.setEnhanceCounter(counter.text);
      counterNode.textContent = `Limit: ${counter.text}`;

      const ratio = counter.current / counter.limit;
      if (ratio <= 0.2) {
        counterNode.classList.add("upgrader-launcher-counter--low");
      } else if (ratio <= 0.5) {
        counterNode.classList.add("upgrader-launcher-counter--mid");
      } else {
        counterNode.classList.add("upgrader-launcher-counter--good");
      }
    },

    refreshDailyEnhancePoints() {
      const pointsNode = document.getElementById("upgrader-launcher-points");
      if (!pointsNode) return;

      const currentPoints = Storage.getDailyEnhancePoints();
      state.dailyEnhancePoints = currentPoints;
      pointsNode.textContent = `Punkty dziś: ${Utils.formatPoints(currentPoints)}`;
    },

    renderAutoSettings() {
      const toggle = document.getElementById("upgrader-auto-enabled");
      const slider = document.getElementById("upgrader-auto-min-free-slots");
      const value = document.getElementById("upgrader-auto-min-free-slots-value");
      const info = document.getElementById("upgrader-auto-free-slots-info");
      if (!toggle || !slider || !value || !info) return;

      const settings = state.autoSettings || { ...CONFIG.DEFAULT_AUTO_SETTINGS };

      toggle.checked = settings.enabled;
      slider.value = String(settings.minFreeSlots);
      slider.disabled = !settings.enabled;
      value.textContent = String(settings.minFreeSlots);

      const freeSlotsInfo = Inventory.getFreeSlotsInfo();
      const freeSlots = freeSlotsInfo.freeSlots;

      info.textContent =
        freeSlots === null
          ? "Wolne sloty: nie udało się odczytać"
          : `Wolne sloty teraz: ${freeSlots}`;
    },

    bindAutoSettingsHandlers() {
      const toggle = document.getElementById("upgrader-auto-enabled");
      const slider = document.getElementById("upgrader-auto-min-free-slots");
      const value = document.getElementById("upgrader-auto-min-free-slots-value");
      if (!toggle || !slider || !value) return;

      toggle.addEventListener("change", () => {
        state.autoSettings = Storage.setAutoSettings({
          ...state.autoSettings,
          enabled: toggle.checked,
        });

        const autoModeLabel = state.mode === "salvage" ? "rozbijanie" : "ulepszanie";
        const autoModeLabelCapitalized =
          state.mode === "salvage" ? "Auto rozbijanie" : "Auto ulepszanie";

        Ui.renderAutoSettings();
        message(
          state.autoSettings.enabled
            ? `${autoModeLabelCapitalized} włączone (próg: ${state.autoSettings.minFreeSlots} wolnych slotów)`
            : `${autoModeLabelCapitalized} wyłączone`
        );
      });

      slider.addEventListener("input", () => {
        value.textContent = slider.value;
      });

      slider.addEventListener("change", () => {
        state.autoSettings = Storage.setAutoSettings({
          ...state.autoSettings,
          minFreeSlots: slider.value,
        });

        const autoModeLabel = state.mode === "salvage" ? "rozbijania" : "ulepszania";

        Ui.renderAutoSettings();
        message(
          `Zapisano próg auto-${autoModeLabel}: ${state.autoSettings.minFreeSlots} wolnych slotów`
        );
      });
    },

    renderBoundSettings() {
      const soulboundToggle = document.getElementById("upgrader-allow-soulbound");
      const permboundToggle = document.getElementById("upgrader-allow-permbound");
      if (!soulboundToggle || !permboundToggle) return;

      const settings = state.boundSettings || { ...CONFIG.DEFAULT_BOUND_SETTINGS };
      soulboundToggle.checked = settings.allowSoulbound;
      permboundToggle.checked = settings.allowPermbound;
    },

    bindBoundSettingsHandlers() {
      const soulboundToggle = document.getElementById("upgrader-allow-soulbound");
      const permboundToggle = document.getElementById("upgrader-allow-permbound");
      if (!soulboundToggle || !permboundToggle) return;

      const update = () => {
        state.boundSettings = Storage.setBoundSettings({
          allowSoulbound: soulboundToggle.checked,
          allowPermbound: permboundToggle.checked,
        });
      };

      soulboundToggle.addEventListener("change", update);
      permboundToggle.addEventListener("change", update);
    },

    renderRarityOptions() {
      const wrap = document.getElementById("upgrader-rarity-list");
      if (!wrap) return;

      const selectedRarities = Storage.getAllowedRarities();
      wrap.innerHTML = "";

      CONFIG.AVAILABLE_RARITIES.forEach((rarity) => {
        const rarityMeta = {
          common: {
            label: "Zwyklaki",
            className: "upgrader-rarity-common",
          },
          unique: {
            label: "Unikaty",
            className: "upgrader-rarity-unique",
          },
          heroic: {
            label: "Heroiki",
            className: "upgrader-rarity-heroic",
          },
        };

        const label = document.createElement("label");
        label.className = "upgrader-gui-rarity-item";

        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "upgrader-rarity-checkbox";
        input.value = rarity;
        input.checked = selectedRarities.includes(rarity);
        input.disabled = state.mode === "salvage" && rarity === "heroic";

        const span = document.createElement("span");
  span.textContent = rarityMeta[rarity]?.label || rarity;
  span.className = rarityMeta[rarity]?.className || "";

        label.appendChild(input);
        label.appendChild(span);
        wrap.appendChild(label);
      });
    },

    enforceSafeRaritiesForMode(showMessage = false) {
      if (state.mode !== "salvage") {
        return;
      }

      const selected = Storage.getAllowedRarities();
      if (!selected.includes("heroic")) {
        return;
      }

      const withoutHeroic = selected.filter((rarity) => rarity !== "heroic");
      Storage.setAllowedRarities(withoutHeroic);

      if (showMessage) {
        message("W trybie rozbijania heroiki są automatycznie wyłączone.");
      }
    },

    renderModeSwitch() {
      const modeToggle = document.getElementById("upgrader-mode-toggle");
      const modeValue = document.getElementById("upgrader-mode-value");
      if (!modeToggle || !modeValue) return;

      const isSalvage = state.mode === "salvage";
      modeToggle.checked = isSalvage;
      modeValue.textContent = isSalvage ? "ROZBIJANIE" : "ULEPSZANIE";
      modeValue.className = `upgrader-mode-value ${
        isSalvage
          ? "upgrader-mode-value--salvage"
          : "upgrader-mode-value--enhancement"
      }`;
    },

    renderModeDependentTexts() {
      const manualButton = document.getElementById("upgrader-launcher-enhance-btn");
      const launcherMode = document.getElementById("upgrader-launcher-mode");
      const hint = document.getElementById("upgrader-select-hint");
      const autoLabel = document.getElementById("upgrader-auto-label");
      const previewWrap = document.getElementById("upgrader-selected-preview-wrap");

      const isSalvage = state.mode === "salvage";

      if (manualButton) {
        manualButton.textContent = isSalvage ? "ROZBIJ" : "ULEPSZ";
      }

      if (launcherMode) {
        launcherMode.textContent = isSalvage ? "Tryb: rozbijanie" : "Tryb: ulepszanie";
        launcherMode.className = `upgrader-launcher-mode ${
          isSalvage
            ? "upgrader-launcher-mode--salvage"
            : "upgrader-launcher-mode--enhancement"
        }`;
      }

      if (hint) {
        hint.textContent = isSalvage
          ? "Tryb rozbijania: addon użyje wybranych rzadkości i rozbije pasujące przedmioty."
          : "Wybór przedmiotu: kliknij PPM na itemie i użyj opcji „Ulepsz ten przedmiot”.";
      }

      if (autoLabel) {
        autoLabel.textContent = isSalvage ? "Auto rozbijanie" : "Auto ulepszanie";
      }

      if (previewWrap) {
        previewWrap.style.display = isSalvage ? "none" : "block";
      }
    },

    bindModeHandlers() {
      const modeToggle = document.getElementById("upgrader-mode-toggle");
      if (!modeToggle) return;

      modeToggle.addEventListener("change", () => {
        state.mode = Storage.setMode(modeToggle.checked ? "salvage" : "enhancement");
        Ui.enforceSafeRaritiesForMode(true);
        Ui.renderModeSwitch();
        Ui.renderModeDependentTexts();
        Ui.renderRarityOptions();

      });
    },

    getSelectedRaritiesFromGui() {
      const nodes = document.querySelectorAll(".upgrader-rarity-checkbox:checked");
      return [...nodes].map((node) => node.value);
    },

    renderHotkeyInputs() {
      const enhanceInput = document.getElementById("upgrader-hotkey-enhance");
      const salvageInput = document.getElementById("upgrader-hotkey-salvage");
      const guiInput = document.getElementById("upgrader-hotkey-gui");
      if (!enhanceInput || !salvageInput || !guiInput) return;

      const hotkeys = state.hotkeys || { ...CONFIG.DEFAULT_HOTKEYS };
      enhanceInput.value = hotkeys.enhance;
      salvageInput.value = hotkeys.salvage;
      guiInput.value = hotkeys.gui;
    },

    getHotkeysFromGui() {
      const enhanceInput = document.getElementById("upgrader-hotkey-enhance");
      const salvageInput = document.getElementById("upgrader-hotkey-salvage");
      const guiInput = document.getElementById("upgrader-hotkey-gui");

      return {
        enhance: enhanceInput?.value,
        salvage: salvageInput?.value,
        gui: guiInput?.value,
      };
    },

    applyButtonPosition() {
      const button = document.getElementById("upgrader-launcher");
      if (!button) return;

      const position = Storage.getGuiPosition();
      button.style.top = `${position.top}px`;

      if (typeof position.left === "number") {
        button.style.left = `${position.left}px`;
        button.style.right = "auto";
      } else {
        button.style.left = "auto";
        button.style.right = `${position.right}px`;
      }
    },

    saveButtonPosition(left, top) {
      const button = document.getElementById("upgrader-launcher");
      if (!button) return;

      const maxLeft = Math.max(window.innerWidth - button.offsetWidth, 0);
      const maxTop = Math.max(window.innerHeight - button.offsetHeight, 0);

      const finalLeft = Utils.clamp(left, 0, maxLeft);
      const finalTop = Utils.clamp(top, 0, maxTop);

      button.style.left = `${finalLeft}px`;
      button.style.top = `${finalTop}px`;
      button.style.right = "auto";

      Storage.setGuiPosition({ left: finalLeft, top: finalTop, right: null });
    },

    applyPanelPosition() {
      const panel = document.getElementById("upgrader-gui-panel");
      if (!panel) return;

      const position = Storage.getPanelPosition();
      panel.style.top = `${position.top}px`;

      if (typeof position.left === "number") {
        panel.style.left = `${position.left}px`;
        panel.style.right = "auto";
      } else {
        panel.style.left = "auto";
        panel.style.right = `${position.right}px`;
      }
    },

    savePanelPosition(left, top) {
      const panel = document.getElementById("upgrader-gui-panel");
      if (!panel) return;

      const maxLeft = Math.max(window.innerWidth - panel.offsetWidth, 0);
      const maxTop = Math.max(window.innerHeight - panel.offsetHeight, 0);

      const finalLeft = Utils.clamp(left, 0, maxLeft);
      const finalTop = Utils.clamp(top, 0, maxTop);

      panel.style.left = `${finalLeft}px`;
      panel.style.top = `${finalTop}px`;
      panel.style.right = "auto";

      Storage.setPanelPosition({ left: finalLeft, top: finalTop, right: null });
    },

    keepElementInViewport(element, fallbackPosition = {}) {
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const maxLeft = Math.max(window.innerWidth - rect.width, 0);
      const maxTop = Math.max(window.innerHeight - rect.height, 0);

      const computed = window.getComputedStyle(element);
      const parsedLeft = Utils.toNumber(parseFloat(element.style.left), NaN);
      const parsedTop = Utils.toNumber(parseFloat(element.style.top), NaN);
      const parsedRight = Utils.toNumber(parseFloat(element.style.right), NaN);
      const computedLeft = Utils.toNumber(parseFloat(computed.left), NaN);
      const computedTop = Utils.toNumber(parseFloat(computed.top), NaN);

      let currentLeft = Number.isFinite(parsedLeft)
        ? parsedLeft
        : Number.isFinite(computedLeft)
        ? computedLeft
        : null;
      let currentTop = Number.isFinite(parsedTop)
        ? parsedTop
        : Number.isFinite(computedTop)
        ? computedTop
        : null;

      if (currentLeft === null && Number.isFinite(parsedRight)) {
        currentLeft = window.innerWidth - rect.width - parsedRight;
      }

      if (currentLeft === null && typeof fallbackPosition?.left === "number") {
        currentLeft = fallbackPosition.left;
      }

      if (currentLeft === null && typeof fallbackPosition?.right === "number") {
        currentLeft = window.innerWidth - rect.width - fallbackPosition.right;
      }

      if (currentTop === null && typeof fallbackPosition?.top === "number") {
        currentTop = fallbackPosition.top;
      }

      const safeLeft = Utils.clamp(
        Math.round(Utils.toNumber(currentLeft, 0)),
        0,
        maxLeft
      );
      const safeTop = Utils.clamp(
        Math.round(Utils.toNumber(currentTop, 0)),
        0,
        maxTop
      );

      element.style.left = `${safeLeft}px`;
      element.style.top = `${safeTop}px`;
      element.style.right = "auto";
    },

    getViewportSize() {
      const viewport = window.visualViewport;
      if (viewport && Number.isFinite(viewport.width) && Number.isFinite(viewport.height)) {
        return {
          width: Math.max(1, Math.round(viewport.width)),
          height: Math.max(1, Math.round(viewport.height)),
        };
      }

      return {
        width: Math.max(1, window.innerWidth || 1),
        height: Math.max(1, window.innerHeight || 1),
      };
    },

    keepElementRelativeOnResize(element, fallbackPosition, resizeMeta) {
      if (!element || !resizeMeta) return;

      const { previousWidth, previousHeight, width, height } = resizeMeta;
      if (
        !Number.isFinite(previousWidth) ||
        !Number.isFinite(previousHeight) ||
        previousWidth <= 0 ||
        previousHeight <= 0
      ) {
        Ui.keepElementInViewport(element, fallbackPosition);
        return;
      }

      Ui.keepElementInViewport(element, fallbackPosition);

      const rect = element.getBoundingClientRect();
      const currentLeft = Utils.toNumber(parseFloat(element.style.left), 0);
      const currentTop = Utils.toNumber(parseFloat(element.style.top), 0);

      const scaledLeft = (currentLeft / previousWidth) * width;
      const scaledTop = (currentTop / previousHeight) * height;

      const maxLeft = Math.max(width - rect.width, 0);
      const maxTop = Math.max(height - rect.height, 0);

      const safeLeft = Utils.clamp(Math.round(scaledLeft), 0, maxLeft);
      const safeTop = Utils.clamp(Math.round(scaledTop), 0, maxTop);

      element.style.left = `${safeLeft}px`;
      element.style.top = `${safeTop}px`;
      element.style.right = "auto";
    },

    ensureFloatingUiVisible(resizeMeta = null) {
      const button = document.getElementById("upgrader-launcher");
      if (button) {
        if (resizeMeta) {
          Ui.keepElementRelativeOnResize(
            button,
            Storage.getGuiPosition(),
            resizeMeta
          );
        } else {
          Ui.keepElementInViewport(button, Storage.getGuiPosition());
        }

        const buttonLeft = Utils.toNumber(parseFloat(button.style.left), NaN);
        const buttonTop = Utils.toNumber(parseFloat(button.style.top), NaN);
        if (Number.isFinite(buttonLeft) && Number.isFinite(buttonTop)) {
          Storage.setGuiPosition({
            left: Math.round(buttonLeft),
            top: Math.round(buttonTop),
            right: null,
          });
        }
      }

      const panel = document.getElementById("upgrader-gui-panel");
      if (panel) {
        if (resizeMeta) {
          Ui.keepElementRelativeOnResize(
            panel,
            Storage.getPanelPosition(),
            resizeMeta
          );
        } else {
          Ui.keepElementInViewport(panel, Storage.getPanelPosition());
        }

        const panelLeft = Utils.toNumber(parseFloat(panel.style.left), NaN);
        const panelTop = Utils.toNumber(parseFloat(panel.style.top), NaN);
        if (Number.isFinite(panelLeft) && Number.isFinite(panelTop)) {
          Storage.setPanelPosition({
            left: Math.round(panelLeft),
            top: Math.round(panelTop),
            right: null,
          });
        }
      }
    },

    initViewportResizeHandler() {
      let resizeTimeout = null;

      const scheduleViewportCorrection = () => {
        if (resizeTimeout) {
          clearTimeout(resizeTimeout);
        }

        resizeTimeout = setTimeout(() => {
          const nextViewportSize = Ui.getViewportSize();
          const previousViewportSize = state.viewportSize || nextViewportSize;

          Ui.ensureFloatingUiVisible({
            previousWidth: previousViewportSize.width,
            previousHeight: previousViewportSize.height,
            width: nextViewportSize.width,
            height: nextViewportSize.height,
          });

          state.viewportSize = nextViewportSize;
        }, 80);
      };

      window.addEventListener("resize", () => {
        scheduleViewportCorrection();
      });

      window.addEventListener("orientationchange", () => {
        scheduleViewportCorrection();
      });

      const viewport = window.visualViewport;
      if (viewport) {
        viewport.addEventListener("resize", scheduleViewportCorrection);
        viewport.addEventListener("scroll", scheduleViewportCorrection);
      }
    },

    initButtonDrag() {
      const button = document.getElementById("upgrader-launcher");
      const handle = document.getElementById("upgrader-launcher-title");
      if (!button || !handle) return;

      handle.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        if (event.target?.closest?.("#upgrader-gui-close-btn")) return;

        event.preventDefault();

        const buttonRect = button.getBoundingClientRect();
        const offsetX = event.clientX - buttonRect.left;
        const offsetY = event.clientY - buttonRect.top;

        const onMouseMove = (moveEvent) => {
          const nextLeft = moveEvent.clientX - offsetX;
          const nextTop = moveEvent.clientY - offsetY;
          Ui.saveButtonPosition(nextLeft, nextTop);
        };

        const onMouseUp = () => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
    },

    initPanelDrag() {
      const panel = document.getElementById("upgrader-gui-panel");
      const handle = document.getElementById("upgrader-gui-title");
      if (!panel || !handle) return;

      handle.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;

        event.preventDefault();

        const panelRect = panel.getBoundingClientRect();
        const offsetX = event.clientX - panelRect.left;
        const offsetY = event.clientY - panelRect.top;

        const onMouseMove = (moveEvent) => {
          const nextLeft = moveEvent.clientX - offsetX;
          const nextTop = moveEvent.clientY - offsetY;
          Ui.savePanelPosition(nextLeft, nextTop);
        };

        const onMouseUp = () => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
    },

    getInterfaceWidgetHost() {
      const strictHost =
        document.querySelector(
          ".top-left.main-buttons-container.static-widget-position"
        ) ||
        document.querySelector(
          ".top-right.main-buttons-container.static-widget-position"
        ) ||
        document.querySelector(".top-left.main-buttons-container") ||
        document.querySelector(".top-right.main-buttons-container");
      if (strictHost) {
        return strictHost;
      }

      const existingWidget =
        document.querySelector(
          ".widget-button.widget-world-icon.widget-in-interface-bar"
        ) ||
        document.querySelector(
          ".widget-button.widget-vaddonz.widget-in-interface-bar"
        ) ||
        document.querySelector(
          ".widget-button.widget-in-interface-bar"
        );
      if (existingWidget?.parentElement) {
        return existingWidget.parentElement;
      }

      const hostSelectors = [
        ".interface-bar",
        ".widget-layer",
        ".interface-layer",
        ".left-interface",
      ];

      for (const selector of hostSelectors) {
        const host = document.querySelector(selector);
        if (host) return host;
      }

      return null;
    },

    bindInterfaceWidget(widgetButton) {
      if (!widgetButton) return;
      if (widgetButton.dataset.upgraderBound === "1") {
        Ui.initInterfaceWidgetDraggable(widgetButton);
        return;
      }

      widgetButton.dataset.upgraderBound = "1";

      widgetButton.addEventListener("click", (event) => {
        if (Ui.isInterfaceWidgetConfigMode(widgetButton)) {
          return;
        }

        event.preventDefault();
        Ui.toggleLauncherVisibility();
      });

      widgetButton.addEventListener("contextmenu", async (event) => {
        if (Ui.isInterfaceWidgetConfigMode(widgetButton)) {
          return;
        }

        event.preventDefault();
        Ui.toggleLauncherVisibility();
      });

      Ui.initInterfaceWidgetDraggable(widgetButton);
    },

    isInterfaceWidgetConfigMode(widgetButton) {
      if (!widgetButton) return false;

      if (widgetButton.classList.contains("ui-draggable-dragging")) {
        return true;
      }

      return !widgetButton.classList.contains("ui-draggable-disabled");
    },

    isGameInterfaceConfigModeActive() {
      return Boolean(
        document.querySelector(
          ".interface-config, .interface-configuration, .configuration-window, .ui-widget-config"
        )
      );
    },

    persistInterfaceWidgetPlacement(widgetButton) {
      const host = widgetButton?.parentElement;
      if (!host) return;

      const slotStep = Ui.getWidgetSlotStep();
      const leftValue = Utils.toNumber(parseFloat(widgetButton.style.left), 0);
      const slot = Math.max(0, Math.round(leftValue / slotStep));
      const top = Ui.getWidgetTopForHost(host);
      const widgetPos = host.classList.contains("top-right")
        ? "top-right"
        : "top-left";

      const { occupiedIndices } = Ui.getOccupiedWidgetSlots(host, widgetButton);
      const preferredIndex = Math.max(
        0,
        Math.floor(Utils.toNumber(widgetButton.getAttribute("widget-index"), slot))
      );
      const widgetIndex =
        !occupiedIndices.has(preferredIndex) && preferredIndex >= 0
          ? preferredIndex
          : Ui.getFirstFreeInteger(occupiedIndices, slot, 500);

      widgetButton.setAttribute("widget-pos", widgetPos);
      widgetButton.setAttribute("widget-index", String(widgetIndex));
      widgetButton.style.left = `${slot * slotStep}px`;
      widgetButton.style.top = `${top}px`;

      Storage.setWidgetSlot({
        widgetPos,
        slot,
        widgetIndex,
      });
    },

    syncInterfaceWidgetDragState(widgetButton) {
      const jq = window.jQuery || window.$;
      if (!jq || typeof jq.fn?.draggable !== "function") return;

      const $widget = jq(widgetButton);
      if (!$widget.data("ui-draggable")) return;

      const configModeEnabled = Ui.isGameInterfaceConfigModeActive();
      $widget.draggable("option", "disabled", !configModeEnabled);
      widgetButton.classList.toggle("ui-draggable-disabled", !configModeEnabled);
    },

    initInterfaceWidgetDraggable(widgetButton) {
      const jq = window.jQuery || window.$;
      if (!jq || typeof jq.fn?.draggable !== "function") return;

      const $widget = jq(widgetButton);
      if (!$widget.data("ui-draggable")) {
        $widget.draggable({
          containment: "parent",
          grid: [Ui.getWidgetSlotStep(), Ui.getWidgetSlotStep()],
          scroll: false,
          disabled: true,
          start() {
            widgetButton.classList.add("ui-draggable-dragging");
          },
          stop() {
            widgetButton.classList.remove("ui-draggable-dragging");
            Ui.persistInterfaceWidgetPlacement(widgetButton);
          },
        });
      }

      Ui.syncInterfaceWidgetDragState(widgetButton);

      if (!state.interfaceWidgetDragObserver) {
        state.interfaceWidgetDragObserver = new MutationObserver(() => {
          const currentWidget = document.getElementById("upgrader-interface-widget");
          if (currentWidget) {
            Ui.syncInterfaceWidgetDragState(currentWidget);
          }
        });

        state.interfaceWidgetDragObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class"],
        });
      }
    },

    extractUrlFromBackgroundImage(backgroundImageValue) {
      const match = String(backgroundImageValue || "").match(/url\(["']?(.*?)["']?\)/i);
      return match?.[1] || null;
    },

    parseBackgroundPosition(backgroundPositionValue) {
      const normalized = String(backgroundPositionValue || "").trim();
      if (!normalized) {
        return { x: 0, y: 0 };
      }

      const parts = normalized.split(/\s+/);
      const x = Utils.toNumber(parseFloat(parts[0]), 0);
      const y = Utils.toNumber(parseFloat(parts[1]), 0);

      return { x, y };
    },

    async setWidgetFaceIconFromOutfit() {
      const widgetIcon = document.querySelector(
        "#upgrader-interface-widget .icon.upgrader-widget-icon"
      );
      const outfitGraphic = document.querySelector(".outfit-wrapper .outfit-graphic");
      if (!widgetIcon || !outfitGraphic) return false;

      const computed = window.getComputedStyle(outfitGraphic);
      const backgroundImage =
        computed.backgroundImage || outfitGraphic.style.backgroundImage;
      const backgroundPosition =
        computed.backgroundPosition || outfitGraphic.style.backgroundPosition;

      const imageUrl = Ui.extractUrlFromBackgroundImage(backgroundImage);
      if (!imageUrl) return false;

      const { x, y } = Ui.parseBackgroundPosition(backgroundPosition);

      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const image = new Image();
          image.crossOrigin = "anonymous";
          image.onload = () => {
            try {
              const canvas = document.createElement("canvas");
              canvas.width = 32;
              canvas.height = 32;
              const context = canvas.getContext("2d");
              if (!context) {
                reject(new Error("no-canvas-context"));
                return;
              }

              const sourceX = Math.max(0, Math.round(-x + 8));
              const sourceY = Math.max(0, Math.round(-y + 2));
              context.imageSmoothingEnabled = false;
              context.drawImage(image, sourceX, sourceY, 16, 16, 0, 0, 32, 32);
              resolve(canvas.toDataURL("image/png"));
            } catch (error) {
              reject(error);
            }
          };
          image.onerror = () => reject(new Error("outfit-image-load-failed"));
          image.src = imageUrl;
        });

        widgetIcon.textContent = "";
        widgetIcon.style.backgroundImage = `url(${dataUrl})`;
        widgetIcon.style.backgroundPosition = "calc(50% + 2px) 50%";
        widgetIcon.style.backgroundSize = "94% 94%";
        return true;
      } catch (error) {
        widgetIcon.textContent = "";
        widgetIcon.style.backgroundImage = backgroundImage;
        widgetIcon.style.backgroundPosition = "calc(50% + 10px) 50%";
        widgetIcon.style.backgroundSize = "94% 94%";
        return true;
      }
    },

    ensureWidgetIconFromOutfit() {
      let attempts = 0;

      const trySetIcon = async () => {
        attempts += 1;
        const applied = await Ui.setWidgetFaceIconFromOutfit();
        if (!applied && attempts < 25) {
          setTimeout(trySetIcon, 300);
        }
      };

      trySetIcon();
    },

    isInterfaceWidgetVisible(widgetButton) {
      if (!widgetButton) return false;

      const rect = widgetButton.getBoundingClientRect();
      if (!rect || rect.width < 20 || rect.height < 20) return false;

      const style = window.getComputedStyle(widgetButton);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Utils.toNumber(parseFloat(style.opacity), 1) <= 0.05
      ) {
        return false;
      }

      return (
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.top < window.innerHeight
      );
    },

    syncLauncherVisibility() {
      const launcher = document.getElementById("upgrader-launcher");
      if (!launcher) return;

      launcher.style.display = state.launcherVisible ? "block" : "none";
    },

    toggleLauncherVisibility(forceVisible = null) {
      const launcher = document.getElementById("upgrader-launcher");
      if (!launcher) return;

      const nextVisible =
        typeof forceVisible === "boolean"
          ? forceVisible
          : launcher.style.display === "none";

      state.launcherVisible = nextVisible;
      Storage.setLauncherVisibility(nextVisible);
      Ui.syncLauncherVisibility();
    },

    mountInterfaceWidget() {
      const existingWidget = document.getElementById("upgrader-interface-widget");
      if (existingWidget) {
        Ui.bindInterfaceWidget(existingWidget);

        const existingHost = existingWidget.parentElement;
        if (existingHost) {
          const savedSlot = Storage.getWidgetSlot();
          const placement = Ui.resolveInterfaceWidgetPlacement(
            existingHost,
            savedSlot,
            existingWidget
          );

          existingWidget.setAttribute("widget-pos", placement.widgetPos);
          existingWidget.setAttribute("widget-index", String(placement.widgetIndex));
          existingWidget.style.left = `${placement.left}px`;
          existingWidget.style.top = `${placement.top}px`;
          Storage.setWidgetSlot(placement);
        }

        state.hasInterfaceWidget = true;
        Ui.syncLauncherVisibility();
        return true;
      }

      const host = Ui.getInterfaceWidgetHost();
      if (!host) {
        state.hasInterfaceWidget = false;
        Ui.syncLauncherVisibility();
        return false;
      }

      const savedSlot = Storage.getWidgetSlot();
      const placement = Ui.resolveInterfaceWidgetPlacement(host, savedSlot, null);

      const widgetButton = document.createElement("div");
      widgetButton.id = "upgrader-interface-widget";
      widgetButton.className =
        "widget-button green widget-in-interface-bar widget-upgrader-addon widget-quickforge ui-draggable ui-draggable-handle ui-draggable-disabled";
      widgetButton.setAttribute("widget-name", "upgrader-addon");
      widgetButton.setAttribute("widget-pos", placement.widgetPos);
      widgetButton.setAttribute("widget-index", String(placement.widgetIndex));
      widgetButton.title = "QuickForge (LPM: panel, PPM: akcja)";
      widgetButton.style.width = "44px";
      widgetButton.style.height = "44px";
      widgetButton.style.position = "absolute";
      widgetButton.style.left = `${placement.left}px`;
      widgetButton.style.top = `${placement.top}px`;

      widgetButton.innerHTML = `
        <div class="icon upgrader-widget-icon"></div>
        <div class="red-notification interface-element-red-notification" style="display: none;"></div>
        <div class="amount"></div>
      `;

      host.appendChild(widgetButton);
      Ui.bindInterfaceWidget(widgetButton);
      Storage.setWidgetSlot(placement);

      state.hasInterfaceWidget = true;
      Ui.syncLauncherVisibility();
      return true;
    },

    getWidgetSlotStep() {
      return 44;
    },

    getWidgetTopForHost(host) {
      const siblings = [
        ...host.querySelectorAll(".widget-button.widget-in-interface-bar"),
      ];

      for (const sibling of siblings) {
        const siblingTop = Utils.toNumber(parseFloat(sibling.style.top), NaN);
        if (Number.isFinite(siblingTop)) {
          return Math.round(siblingTop);
        }
      }

      return 0;
    },

    getOccupiedWidgetSlots(host, ignoredNode = null) {
      const slotStep = Ui.getWidgetSlotStep();
      const occupiedSlots = new Set();
      const occupiedIndices = new Set();

      const widgets = [
        ...host.querySelectorAll(".widget-button.widget-in-interface-bar"),
      ].filter((node) => node !== ignoredNode);

      widgets.forEach((node) => {
        const leftValue = Utils.toNumber(parseFloat(node.style.left), NaN);
        if (Number.isFinite(leftValue) && leftValue >= 0) {
          occupiedSlots.add(Math.round(leftValue / slotStep));
        }

        const widgetIndex = Utils.toNumber(node.getAttribute("widget-index"), NaN);
        if (Number.isFinite(widgetIndex) && widgetIndex >= 0) {
          occupiedIndices.add(Math.floor(widgetIndex));
        }
      });

      return { occupiedSlots, occupiedIndices };
    },

    getFirstFreeInteger(occupiedSet, startAt = 0, maxScan = 300) {
      const safeStart = Math.max(0, Math.floor(Utils.toNumber(startAt, 0)));

      for (let value = safeStart; value <= maxScan; value += 1) {
        if (!occupiedSet.has(value)) {
          return value;
        }
      }

      return maxScan + 1;
    },

    resolveInterfaceWidgetPlacement(host, savedSlot = null, ignoredNode = null) {
      const widgetPos = host.classList.contains("top-right")
        ? "top-right"
        : "top-left";
      const slotStep = Ui.getWidgetSlotStep();
      const top = Ui.getWidgetTopForHost(host);
      const { occupiedSlots, occupiedIndices } = Ui.getOccupiedWidgetSlots(
        host,
        ignoredNode
      );

      const savedForThisSide =
        savedSlot && savedSlot.widgetPos === widgetPos ? savedSlot : null;

      const preferredSlot = Number.isFinite(savedForThisSide?.slot)
        ? Math.max(0, Math.floor(savedForThisSide.slot))
        : null;
      const preferredIndex = Number.isFinite(savedForThisSide?.widgetIndex)
        ? Math.max(0, Math.floor(savedForThisSide.widgetIndex))
        : null;

      const slot =
        preferredSlot !== null && !occupiedSlots.has(preferredSlot)
          ? preferredSlot
          : Ui.getFirstFreeInteger(occupiedSlots, 0, 300);

      const widgetIndex =
        preferredIndex !== null && !occupiedIndices.has(preferredIndex)
          ? preferredIndex
          : Ui.getFirstFreeInteger(occupiedIndices, slot, 500);

      return {
        widgetPos,
        slot,
        widgetIndex,
        left: slot * slotStep,
        top,
      };
    },

    ensureInterfaceWidgetMounted() {
      let attempts = 0;
      const tryMount = () => {
        attempts += 1;
        const mounted = Ui.mountInterfaceWidget();
        if (!mounted && attempts < 120) {
          setTimeout(tryMount, 400);
        }
      };

      tryMount();

      const observer = new MutationObserver(() => {
        if (!document.getElementById("upgrader-interface-widget")) {
          Ui.mountInterfaceWidget();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    },

    bindLauncherButtons() {
      const configButton = document.getElementById("upgrader-launcher-config-btn");
      const manualButton = document.getElementById("upgrader-launcher-enhance-btn");
      if (!configButton || !manualButton) return;

      configButton.addEventListener("click", () => {
        Ui.toggleGui();
      });

      manualButton.addEventListener("click", async () => {
        await Automation.runPrimaryAction();
      });
    },

    bindRarityAutoSaveHandlers() {
      const rarityList = document.getElementById("upgrader-rarity-list");
      if (!rarityList) return;

      rarityList.addEventListener("change", (event) => {
        const target = event.target;
        if (!target || !target.classList?.contains("upgrader-rarity-checkbox")) {
          return;
        }

        if (state.mode === "salvage" && target.value === "heroic" && target.checked) {
          target.checked = false;
          return;
        }

        const selectedRarities = Ui.getSelectedRaritiesFromGui();
        if (selectedRarities.length === 0) {
          target.checked = true;
          return;
        }

        Storage.setAllowedRarities(selectedRarities);
      });
    },

    getOrCreateAddonLikeTooltip() {
      let tooltip = document.getElementById("upgrader-vaddonz-tooltip");
      if (tooltip) {
        return tooltip;
      }

      tooltip = document.createElement("div");
      tooltip.id = "upgrader-vaddonz-tooltip";
      tooltip.className = "vaddonz-tooltip-widget-vaddonz";
      tooltip.style.display = "none";
      tooltip.innerHTML = '<div class="content"><p></p></div>';
      document.body.appendChild(tooltip);

      return tooltip;
    },

    showAddonLikeTooltip(triggerNode) {
      if (!triggerNode) return;

      const text = String(
        triggerNode.getAttribute("data-upgrader-tooltip") || ""
      ).trim();
      if (!text) return;

      const tooltip = Ui.getOrCreateAddonLikeTooltip();
      const paragraph = tooltip.querySelector(".content p");
      if (paragraph) {
        paragraph.textContent = text;
      }

      tooltip.style.display = "block";

      const rect = triggerNode.getBoundingClientRect();
      const viewportPadding = 8;
      let left = Math.round(rect.left + window.scrollX);
      let top = Math.round(rect.top + window.scrollY - tooltip.offsetHeight - 8);

      if (left + tooltip.offsetWidth > window.scrollX + window.innerWidth - viewportPadding) {
        left = Math.round(window.scrollX + window.innerWidth - tooltip.offsetWidth - viewportPadding);
      }

      if (left < window.scrollX + viewportPadding) {
        left = Math.round(window.scrollX + viewportPadding);
      }

      if (top < window.scrollY + viewportPadding) {
        top = Math.round(rect.bottom + window.scrollY + 8);
      }

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    },

    hideAddonLikeTooltip() {
      const tooltip = document.getElementById("upgrader-vaddonz-tooltip");
      if (!tooltip) return;
      tooltip.style.display = "none";
    },

    bindTooltipHandlers() {
      const triggers = document.querySelectorAll(
        ".upgrader-tooltip-trigger[data-upgrader-tooltip]"
      );

      triggers.forEach((triggerNode) => {
        if (triggerNode.dataset.upgraderTooltipBound === "1") {
          return;
        }

        triggerNode.dataset.upgraderTooltipBound = "1";

        triggerNode.addEventListener("mouseenter", () => {
          Ui.showAddonLikeTooltip(triggerNode);
        });

        triggerNode.addEventListener("mousemove", () => {
          Ui.showAddonLikeTooltip(triggerNode);
        });

        triggerNode.addEventListener("mouseleave", () => {
          Ui.hideAddonLikeTooltip();
        });
      });
    },

    showEnhancementCompletionNotification(data) {
      const notificationId = "upgrader-enhancement-notification";
      let notification = document.getElementById(notificationId);

      // Anuluj poprzedni timer jeśli istnieje
      if (state.enhancementNotificationTimer) {
        clearTimeout(state.enhancementNotificationTimer);
        state.enhancementNotificationTimer = null;
      }

      if (!notification) {
        notification = document.createElement("div");
        notification.id = notificationId;
        notification.style.cssText = `
          position: fixed;
          top: 30%;
          left: 50%;
          transform: translate(-50%, -50%) scale(0.9);
          z-index: 99999;
          min-width: 160px;
          max-width: 200px;
          padding: 8px 12px;
          border-radius: 8px;
          background: rgba(30, 20, 60, 0.4);
          backdrop-filter: blur(16px);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(168,85,247,0.2);
          color: #ffffff;
          font-family: "Segoe UI Variable", "Segoe UI", "Trebuchet MS", Tahoma, sans-serif;
          text-align: center;
          pointer-events: none;
          opacity: 0;
          transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        `;
        document.body.appendChild(notification);
      }

      // Resetuj stan powiadomienia
      notification.style.opacity = "0";
      notification.style.transform = "translate(-50%, -50%) scale(0.9)";

      // Pobierz grafikę przedmiotu
      let itemIconHtml = '';
      if (data.itemId) {
        const sourceNode = document.querySelector(`.item-id-${data.itemId}`);
        if (sourceNode) {
          const sourceCanvas = sourceNode.querySelector("canvas.icon.canvas-icon");
          if (sourceCanvas) {
            const iconSrc = sourceCanvas.toDataURL("image/png");
            itemIconHtml = `
              <div style="display: inline-block; width: 32px; height: 32px; margin-bottom: 4px;">
                <img src="${iconSrc}" alt="${data.itemName}" style="width: 100%; height: 100%; image-rendering: pixelated;" />
              </div>
            `;
          }
        }
      }

      notification.innerHTML = `
        <div style="font-size: 8px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 4px; opacity: 0.75; color: #e0e7ff;">
          ✨ Ulepszono
        </div>
        ${itemIconHtml}
        <div style="font-size: 12px; font-weight: 700; margin-bottom: 3px; text-shadow: 0 1px 4px rgba(0,0,0,0.5); line-height: 1.1;">
          ${data.itemName}
        </div>
        <div style="display: inline-block; background: rgba(255,255,255,0.15); border-radius: 8px; padding: 2px 8px; margin-bottom: 4px; font-size: 11px; font-weight: 700;">
          ${data.level}
        </div>
        <div style="font-size: 10px; font-weight: 600; margin-bottom: 3px; opacity: 0.8; color: #e0e7ff;">
          Limit: ${data.counter}
        </div>
        <div style="font-size: 18px; font-weight: 800; color: #fbbf24; text-shadow: 0 0 12px rgba(251,191,36,0.6), 0 1px 4px rgba(0,0,0,0.5);">
          +${data.points}
        </div>
        <div style="font-size: 7px; font-weight: 600; margin-top: 2px; opacity: 0.65; color: #e0e7ff;">
          punktów ulepszenia
        </div>
      `;

      requestAnimationFrame(() => {
        notification.style.opacity = "1";
        notification.style.transform = "translate(-50%, -50%) scale(1)";
      });

      state.enhancementNotificationTimer = setTimeout(() => {
        notification.style.opacity = "0";
        notification.style.transform = "translate(-50%, -60%) scale(0.95)";
        state.enhancementNotificationTimer = null;
      }, 3500);
    },

    showSalvageCompletionNotification(data) {
      const notificationId = "upgrader-salvage-notification";
      let notification = document.getElementById(notificationId);

      // Anuluj poprzedni timer jeśli istnieje
      if (state.salvageNotificationTimer) {
        clearTimeout(state.salvageNotificationTimer);
        state.salvageNotificationTimer = null;
      }

      if (!notification) {
        notification = document.createElement("div");
        notification.id = notificationId;
        notification.style.cssText = `
          position: fixed;
          top: 30%;
          left: 50%;
          transform: translate(-50%, -50%) scale(0.9);
          z-index: 99999;
          min-width: 320px;
          max-width: 420px;
          padding: 24px 32px;
          border-radius: 16px;
          background: linear-gradient(135deg, rgba(35,15,10,0.98) 0%, rgba(140,60,45,0.96) 50%, rgba(180,90,75,0.95) 100%);
          backdrop-filter: blur(10px);
          box-shadow: 0 20px 60px rgba(140,60,45,0.6), 0 0 0 1px rgba(247,120,85,0.3), inset 0 1px 0 rgba(255,255,255,0.2);
          color: #ffffff;
          font-family: "Segoe UI Variable", "Segoe UI", "Trebuchet MS", Tahoma, sans-serif;
          text-align: center;
          pointer-events: none;
          opacity: 0;
          transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        `;
        document.body.appendChild(notification);
      }

      // Resetuj stan powiadomienia
      notification.style.opacity = "0";
      notification.style.transform = "translate(-50%, -50%) scale(0.9)";

      const remainingInfo = data.remainingItems > 0 
        ? `<div style="font-size: 13px; font-weight: 500; margin-top: 14px; opacity: 0.85; color: #ffd7cc; padding: 8px 16px; background: rgba(0,0,0,0.2); border-radius: 8px;">
             ⚠️ Zostało ${data.remainingItems} przedmiotów<br/>
             <span style="font-size: 11px; opacity: 0.8;">nie udało się ich już zaznaczyć</span>
           </div>`
        : `<div style="font-size: 13px; font-weight: 600; margin-top: 14px; opacity: 0.9; color: #a7f3d0;">
             ✓ Wszystko rozbite pomyślnie!
           </div>`;

      notification.innerHTML = `
        <div style="font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 10px; opacity: 0.85; color: #ffd7cc;">
          🔨 Rozbijanie zakończone
        </div>
        <div style="font-size: 32px; font-weight: 900; margin-bottom: 14px; text-shadow: 0 3px 12px rgba(0,0,0,0.4); line-height: 1.2; letter-spacing: -0.5px; color: #fbbf24;">
          ${data.count}
        </div>
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px; opacity: 0.95; color: #ffd7cc;">
          ${data.count === 1 ? 'przedmiot rozbity' : 'przedmiotów rozbitych'}
        </div>
        ${remainingInfo}
      `;

      requestAnimationFrame(() => {
        notification.style.opacity = "1";
        notification.style.transform = "translate(-50%, -50%) scale(1)";
      });

      state.salvageNotificationTimer = setTimeout(() => {
        notification.style.opacity = "0";
        notification.style.transform = "translate(-50%, -60%) scale(0.95)";
        state.salvageNotificationTimer = null;
      }, 3500);
    },

    toggleGui() {
      const panel = document.getElementById("upgrader-gui-panel");
      if (!panel) return;

      state.guiVisible = !state.guiVisible;
      panel.style.display = state.guiVisible ? "block" : "none";

      if (state.guiVisible) {
        Ui.enforceSafeRaritiesForMode();
        Ui.renderModeSwitch();
        Ui.renderModeDependentTexts();
        Ui.applyPanelPosition();
        Ui.renderSelectedItemPreview();
        Ui.renderRarityOptions();
        Ui.renderBoundSettings();
        Ui.renderHotkeyInputs();
        Ui.renderAutoSettings();
        Ui.refreshEnhanceCounter();
      }
    },

    createGui() {
      if (document.getElementById("upgrader-launcher")) return;

      const button = document.createElement("div");
      button.id = "upgrader-launcher";
      button.className = "upgrader-launcher";
      button.innerHTML = `
        <div id="upgrader-launcher-title" class="upgrader-launcher-title">QuickForge</div>
        <div id="upgrader-launcher-counter" class="upgrader-launcher-counter">Limit: --</div>
        <div id="upgrader-launcher-points" class="upgrader-launcher-points">Punkty dziś: 0</div>
        <div id="upgrader-launcher-mode" class="upgrader-launcher-mode upgrader-launcher-mode--enhancement">Tryb: ulepszanie</div>
        <div class="upgrader-launcher-row">
          <button id="upgrader-launcher-config-btn" class="upgrader-launcher-btn">CONFIG</button>
          <button id="upgrader-launcher-enhance-btn" class="upgrader-launcher-btn">ULEPSZ</button>
        </div>
      `;

      const panel = document.createElement("div");
      panel.id = "upgrader-gui-panel";
      panel.className = "upgrader-gui-panel";
      panel.innerHTML = `
        <div id="upgrader-gui-title" class="upgrader-gui-title">
          <span>QuickForge - ustawienia</span>
          <button id="upgrader-gui-close-btn" class="upgrader-gui-close-btn" type="button" aria-label="Zamknij panel">×</button>
        </div>
        <div class="upgrader-mode-wrap">
          <div class="upgrader-mode-row">
            <span class="upgrader-mode-label">Tryb działania</span>
            <span id="upgrader-mode-value" class="upgrader-mode-value">ULEPSZANIE</span>
            <label class="upgrader-mode-switch" for="upgrader-mode-toggle">
              <input id="upgrader-mode-toggle" type="checkbox" />
              <span class="upgrader-mode-slider"></span>
            </label>
          </div>
        </div>
        <div id="upgrader-select-hint" class="upgrader-select-hint">Wybór przedmiotu: kliknij PPM na itemie i użyj opcji „Ulepsz ten przedmiot”.</div>
        <div id="upgrader-selected-preview-wrap" class="upgrader-selected-preview-wrap">
          <div class="upgrader-gui-rarity-title">Wybrany przedmiot:</div>
          <div id="upgrader-selected-preview-box" class="upgrader-selected-preview-box"></div>
          <div id="upgrader-selected-preview-text" class="upgrader-selected-preview-text">Brak wybranego przedmiotu</div>
        </div>
        <div class="upgrader-gui-rarity-wrap">
          <div class="upgrader-gui-rarity-title">Rarity składników:</div>
          <div id="upgrader-rarity-list" class="upgrader-gui-rarity-list"></div>
        </div>
        <div class="upgrader-bound-wrap">
          <div class="upgrader-gui-rarity-title">Blokada przedmiotów związanych:</div>
          <label class="upgrader-bound-item" for="upgrader-allow-soulbound">
            <span>Używaj przedmiotów związanych z właścicielem</span>
            <input id="upgrader-allow-soulbound" type="checkbox" />
          </label>
          <label class="upgrader-bound-item" for="upgrader-allow-permbound">
            <span>Używaj przedmiotów związanych na stałe</span>
            <input id="upgrader-allow-permbound" type="checkbox" />
          </label>
          <div class="upgrader-bound-warning">Uwaga: włączenie może spalić ważne przedmioty.
            <span class="upgrader-tooltip-trigger" data-tooltip="Ta reguła nie działa na heroiki oraz na przedmioty ulepszone">?</span>
          </div>
        </div>
        <div class="upgrader-auto-wrap">
          <div class="upgrader-auto-row">
            <label id="upgrader-auto-label" for="upgrader-auto-enabled">Auto ulepszanie</label>
            <input id="upgrader-auto-enabled" type="checkbox" />
          </div>
          <div class="upgrader-auto-row">
            <label for="upgrader-auto-min-free-slots">Próg wolnych slotów: <span id="upgrader-auto-min-free-slots-value">6</span></label>
          </div>
          <input
            id="upgrader-auto-min-free-slots"
            class="upgrader-auto-slider"
            type="range"
            min="${CONFIG.AUTO_MIN_FREE_SLOTS_RANGE.min}"
            max="${CONFIG.AUTO_MIN_FREE_SLOTS_RANGE.max}"
            value="${CONFIG.DEFAULT_AUTO_SETTINGS.minFreeSlots}"
          />
          <div id="upgrader-auto-free-slots-info" class="upgrader-auto-info"></div>
        </div>
        <div class="upgrader-hotkeys-wrap">
          <div class="upgrader-gui-rarity-title">Skróty klawiszowe:</div>
          <div class="upgrader-hotkeys-grid">
            <div class="upgrader-hotkeys-label">Ulepszanie</div>
            <input id="upgrader-hotkey-enhance" maxlength="1" class="upgrader-hotkeys-input" />
            <div class="upgrader-hotkeys-label">Rozbijanie</div>
            <input id="upgrader-hotkey-salvage" maxlength="1" class="upgrader-hotkeys-input" />
            <div class="upgrader-hotkeys-label">Ustawienia (SHIFT+)</div>
            <input id="upgrader-hotkey-gui" maxlength="1" class="upgrader-hotkeys-input" />
          </div>
        </div>
        <div class="upgrader-gui-row">
          <button id="upgrader-clear-btn" class="upgrader-gui-btn">Wyczyść</button>
          <button id="upgrader-rarity-save-btn" class="upgrader-gui-btn">Reset punktów</button>
          <button id="upgrader-hotkey-save-btn" class="upgrader-gui-btn">Zapisz skróty</button>
        </div>
      `;

      document.body.appendChild(button);
      document.body.appendChild(panel);

      Ui.applyButtonPosition();
      Ui.applyPanelPosition();
      Ui.ensureFloatingUiVisible();
      state.viewportSize = Ui.getViewportSize();
      Ui.initViewportResizeHandler();
      Ui.initButtonDrag();
      Ui.initPanelDrag();
      Ui.bindLauncherButtons();
      Ui.ensureInterfaceWidgetMounted();
      Ui.syncLauncherVisibility();
      Ui.bindAutoSettingsHandlers();
      Ui.bindBoundSettingsHandlers();
      Ui.bindRarityAutoSaveHandlers();
      Ui.bindModeHandlers();
      Ui.bindTooltipHandlers();

      document
        .getElementById("upgrader-clear-btn")
        .addEventListener("click", () => {
          Ui.clearUpgradedItem();
        });

      document
        .getElementById("upgrader-rarity-save-btn")
        .addEventListener("click", () => {
          state.dailyEnhancePoints = Storage.setDailyEnhancePoints(0);
          Ui.refreshDailyEnhancePoints();
          message("Wyzerowano licznik punktów dziennych.");
        });

      document
        .getElementById("upgrader-hotkey-save-btn")
        .addEventListener("click", () => {
          const nextHotkeys = Ui.getHotkeysFromGui();
          const savedHotkeys = Storage.setHotkeys(nextHotkeys);
          state.hotkeys = savedHotkeys;
          Ui.renderHotkeyInputs();
        });

      const closeButton = document.getElementById("upgrader-gui-close-btn");
      if (closeButton) {
        closeButton.addEventListener("mousedown", (event) => {
          event.stopPropagation();
        });

        closeButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          Ui.toggleGui();
        });
      }

      Ui.renderSelectedItemPreview();
      Ui.enforceSafeRaritiesForMode();
      Ui.renderModeSwitch();
      Ui.renderModeDependentTexts();
      Ui.renderRarityOptions();
      Ui.renderBoundSettings();
      Ui.renderAutoSettings();
      Ui.refreshEnhanceCounter();
      Ui.refreshDailyEnhancePoints();
    },

    initItemContextMenu() {
      const ogShowPopupMenu = Engine.interface.showPopupMenu;
      Engine.interface.showPopupMenu = function (menu, e) {
        const itemId = Utils.getItemIdFromClassName(e.currentTarget?.className);

        if (!itemId) {
          return ogShowPopupMenu.call(this, menu, e);
        }

        const item = Engine.items.getItemById(itemId);
        const currentSelectedItemId = Storage.getUpgradedItemId();

        if (!ALLOWED_ITEM_TYPES.includes(item?.cl)) {
          return ogShowPopupMenu.call(this, menu, e);
        }

        const menuItem =
          itemId === currentSelectedItemId
            ? [
                "Anuluj ulepszanie",
                () => {
                  if (!currentSelectedItemId) return;
                  Storage.setUpgradedItemId("");
                  Ui.markItemAsUpgraded(currentSelectedItemId);
                  Ui.renderSelectedItemPreview();
                },
                { button: { cls: "menu-item--red" } },
              ]
            : [
                "Ulepsz ten przedmiot",
                () => {
                  Storage.setUpgradedItemId(itemId);
                  Ui.markItemAsUpgraded(currentSelectedItemId);
                  Ui.renderSelectedItemPreview();
                },
                { button: { cls: "menu-item--yellow" } },
              ];

        const updatedMenu = [menuItem, ...menu];
        ogShowPopupMenu.call(this, updatedMenu, e);
      };
    },
  };

  const Automation = {
    async runPrimaryAction(options = {}) {
      if (state.mode === "salvage") {
        return Automation.salvageEligibleItems(options);
      }

      return Automation.enhanceSelectedItem(options);
    },

    async salvageEligibleItems(options = {}) {
      const { silent = false } = options;

      const result = {
        status: "idle",
        reachedLimit: false,
        reachedMaxEnhancement: false,
        itemName: null,
      };

      if (state.isEnhancing) {
        result.status = "busy";
        return result;
      }

      state.isEnhancing = true;

      const items = Inventory.getItemsForSalvage();
      if (items.length === 0) {
        result.status = "missing-reagents";
        if (!silent) {
          message("Nie znaleziono przedmiotów do rozbijania.");
        }
        state.isEnhancing = false;
        return result;
      }

      let enhancementSession = null;

      try {
        result.status = "running";
        state.salvageReceivedItems = [];
        enhancementSession = Ui.prepareEnhancementWindow();
        await Utils.sleep(150);
        const switchedToSalvage = await Ui.ensureCraftingModeTab();

        if (!switchedToSalvage) {
          result.status = "failed";
          if (!silent) {
            message("Nie udało się przełączyć zakładki rzemiosła na rozbijanie.", "err");
          }
          return result;
        }

        let successCount = 0;
        let noProgressRounds = 0;

        for (let round = 0; round < 120; round += 1) {
          const remainingItems = Inventory.getItemsForSalvage();
          if (remainingItems.length === 0) {
            break;
          }

          const batch = remainingItems.slice(0, CONFIG.MAX_REAGENTS);
          if (batch.length === 0) {
            break;
          }

          const firstBatchItem = Engine.items.getItemById(batch[0]);
          const tabReady = await Ui.ensureCraftingModeTab();
          if (!tabReady) {
            break;
          }

          await Utils.sleep(200);

          const batchResult = await SalvageApi.salvageItemsBatchThroughUi(batch);
          if (batchResult > 0) {
            successCount += batchResult;
            noProgressRounds = 0;
            result.itemName = firstBatchItem?.name || result.itemName;
          } else {
            noProgressRounds += 1;
          }

          if (noProgressRounds >= 4) {
            break;
          }

          await Utils.sleep(320);
        }

        const remainingItems = Inventory.getItemsForSalvage().length;

        if (successCount > 0) {
          result.status = "done";
          if (!silent) {
            Ui.showSalvageCompletionNotification({
              count: successCount,
              remainingItems: remainingItems,
              receivedItems: state.salvageReceivedItems
            });
          }
        } else {
          result.status = "failed";
          if (!silent) {
            message("Nie udało się wykonać rozbijania (sprawdź aktywne okno rzemiosła).", "err");
          }
        }
      } finally {
        state.salvageReceivedItems = [];
        Ui.restoreEnhancementWindow(enhancementSession);
        state.isEnhancing = false;
      }

      return result;
    },

    async enhanceSelectedItem(options = {}) {
      const { silent = false } = options;

      const result = {
        status: "idle",
        reachedLimit: false,
        reachedMaxEnhancement: false,
        itemName: null,
      };

      if (state.isEnhancing) {
        result.status = "busy";
        return result;
      }

      state.isEnhancing = true;

      const upgradedItemId = Storage.getUpgradedItemId();
      const upgradedItem = Engine.items.getItemById(upgradedItemId);
      result.itemName = upgradedItem?.name || null;

      if (!upgradedItem) {
        result.status = "missing-item";
        if (!silent) {
          message("Wybierz przedmiot do ulepszenia.");
        }
        state.isEnhancing = false;
        return result;
      }

      const reagents = Inventory.getReagents();
      if (reagents.length === 0) {
        result.status = "missing-reagents";
        if (!silent) {
          message("Nie znaleziono odpowiednich składników.");
        }
        state.isEnhancing = false;
        return result;
      }

      let enhancementSession = null;

      try {
        result.status = "running";
        state.enhancementRunSummary = {
          itemId: upgradedItemId,
          itemName: upgradedItem?.name || null,
          totalPoints: 0,
          upgradeLevel: null,
        };
        enhancementSession = Ui.prepareEnhancementWindow();
        const chunks = Utils.chunk(reagents, CONFIG.MAX_REAGENTS);
        const statusResponse = await EnhancementApi.setEnhancedItem(upgradedItemId);

        if (Utils.hasMaxEnhancementState(statusResponse)) {
          result.reachedMaxEnhancement = true;
          result.status = "max-enhancement-reached";
          if (!silent) {
            message(
              `Przedmiot${upgradedItem?.name ? ` ${upgradedItem.name}` : ""} został maksymalnie ulepszony. Dalsze ulepszanie zostało zatrzymane.`
            );
          }
          return result;
        }

        let counterSnapshot = Utils.getEnhanceCounterSnapshot();
        let remainingToLimit = null;

        if (counterSnapshot) {
          remainingToLimit = Math.max(
            0,
            counterSnapshot.limit - counterSnapshot.current
          );

          if (remainingToLimit <= 0) {
            result.reachedLimit = true;
            result.status = "limit-reached";
            if (!silent) {
              message("Już wbiłeś limit na dzisiaj.");
            }
            return result;
          }
        }

        for (const chunk of chunks) {
          if (remainingToLimit !== null && remainingToLimit <= 0) {
            break;
          }

          const maxAllowedInChunk =
            remainingToLimit === null
              ? chunk.length
              : Math.min(chunk.length, remainingToLimit);

          if (maxAllowedInChunk <= 0) {
            break;
          }

          const reagentsToUse =
            maxAllowedInChunk === chunk.length
              ? chunk
              : chunk.slice(0, maxAllowedInChunk);

          const reagentsPreviewResponse = await EnhancementApi.setReagents(
            upgradedItemId,
            reagentsToUse
          );

          if (Utils.hasMaxEnhancementState(reagentsPreviewResponse)) {
            result.reachedMaxEnhancement = true;
            result.status = "max-enhancement-reached";
            if (!silent) {
              message(
                `Przedmiot${upgradedItem?.name ? ` ${upgradedItem.name}` : ""} został maksymalnie ulepszony. Dalsze ulepszanie zostało zatrzymane.`
              );
            }
            return result;
          }

          const enhanceItemResponse = await EnhancementApi.enhanceItem(
            upgradedItemId,
            reagentsToUse
          );

          if (Utils.hasMaxEnhancementState(enhanceItemResponse)) {
            result.reachedMaxEnhancement = true;
            result.status = "max-enhancement-reached";
            if (!silent) {
              message(
                `Przedmiot${upgradedItem?.name ? ` ${upgradedItem.name}` : ""} został maksymalnie ulepszony. Dalsze ulepszanie zostało zatrzymane.`
              );
            }
            return result;
          }

          const { count, limit } = enhanceItemResponse.enhancement.usages_preview;

          const parsedCount = Utils.toNumber(count, NaN);
          const parsedLimit = Utils.toNumber(limit, NaN);
          if (Number.isFinite(parsedCount) && Number.isFinite(parsedLimit)) {
            remainingToLimit = Math.max(0, parsedLimit - parsedCount);
            counterSnapshot = {
              current: parsedCount,
              limit: parsedLimit,
              text: `${parsedCount}/${parsedLimit}`,
            };
            state.enhanceCounter = counterSnapshot.text;
            Storage.setEnhanceCounter(counterSnapshot.text);

            if (remainingToLimit <= 0) {
              result.reachedLimit = true;
              result.status = "limit-reached";
            }
          } else if (remainingToLimit !== null) {
            remainingToLimit = Math.max(0, remainingToLimit - reagentsToUse.length);
          }

          await Utils.sleep(300);
        }

        if (result.status !== "limit-reached") {
          result.status = "done";
        }

        const enhancementRunSummary = state.enhancementRunSummary;
        if (
          !silent &&
          enhancementRunSummary &&
          enhancementRunSummary.totalPoints > 0
        ) {
          const levelValue = Utils.toNumber(
            enhancementRunSummary.upgradeLevel,
            NaN
          );
          const levelText = Number.isFinite(levelValue)
            ? `+${levelValue}`
            : "+?";

          const counterSnapshot = Utils.getEnhanceCounterSnapshot();
          const counterText = counterSnapshot
            ? `${counterSnapshot.current}/${counterSnapshot.limit}`
            : "--/--";

          Ui.showEnhancementCompletionNotification({
            itemId: enhancementRunSummary.itemId,
            itemName: enhancementRunSummary.itemName || "Przedmiot",
            level: levelText,
            counter: counterText,
            points: Utils.formatPoints(enhancementRunSummary.totalPoints),
          });
        }
      } finally {
        state.enhancementRunSummary = null;
        Ui.restoreEnhancementWindow(enhancementSession);
        state.isEnhancing = false;
        Ui.refreshEnhanceCounter();
      }

      return result;
    },

    async checkAutoEnhance() {
      if (!state.autoSettings.enabled || state.isEnhancing) {
        return;
      }

      const freeSlots = Inventory.getFreeSlots();
      if (freeSlots === null) {
        return;
      }

      if (freeSlots > state.autoSettings.minFreeSlots) {
        return;
      }

      const now = Date.now();
      if (now - state.lastAutoTriggerAt < 2000) {
        return;
      }

      state.lastAutoTriggerAt = now;
      const enhanceResult = await Automation.runPrimaryAction({ silent: false });

      if (enhanceResult?.reachedLimit || enhanceResult?.reachedMaxEnhancement) {
        state.autoSettings = Storage.setAutoSettings({
          ...state.autoSettings,
          enabled: false,
        });

        const autoModeLabelCapitalized =
          state.mode === "salvage" ? "Auto rozbijanie" : "Auto ulepszanie";
        const limitLabel = state.mode === "salvage" ? "rozbić" : "ulepszeń";

        const targetItemLabel = enhanceResult.itemName
          ? ` dla ${enhanceResult.itemName}`
          : "";

        if (enhanceResult?.reachedMaxEnhancement) {
          message(
            `${autoModeLabelCapitalized} wyłączone: przedmiot${targetItemLabel} jest już maksymalnie ulepszony.`
          );
        } else {
          message(`${autoModeLabelCapitalized} wyłączone: osiągnięto limit ${limitLabel}${targetItemLabel}.`);
        }
      }

      Ui.renderAutoSettings();
    },

    startAutoEnhanceLoop() {
      setInterval(() => {
        Automation.checkAutoEnhance();
      }, 1200);
    },

    startEnhanceCounterSyncLoop() {
      setInterval(() => {
        Ui.refreshEnhanceCounter();
        Ui.refreshDailyEnhancePoints();
      }, 1200);
    },

    bindHotkey() {
      window.document.addEventListener("keydown", async (event) => {
        const isInputActive = ["TEXTAREA", "MAGIC_INPUT", "INPUT"].includes(
          document.activeElement.tagName
        );
        if (isInputActive) return;

        const key = String(event.key || "").toLowerCase();
        const hotkeys = state.hotkeys || CONFIG.DEFAULT_HOTKEYS;
        const activeActionHotkey =
          state.mode === "salvage" ? hotkeys.salvage : hotkeys.enhance;

        if (event.shiftKey && key === hotkeys.gui) {
          event.preventDefault();
          Ui.toggleGui();
          return;
        }

        if (key === activeActionHotkey) {
          await Automation.runPrimaryAction();
        }
      });
    },
  };

  const Runtime = {
    isDuplicateProgressEvent(eventKey) {
      const now = Date.now();
      const DUPLICATE_WINDOW_MS = 1500;

      if (
        state.lastProgressEventKey === eventKey &&
        now - state.lastProgressEventAt < DUPLICATE_WINDOW_MS
      ) {
        return true;
      }

      state.lastProgressEventKey = eventKey;
      state.lastProgressEventAt = now;
      return false;
    },

    initEnhancementProgressHook() {
      if (state.enhancementProgressHooked) return;
      if (typeof window._g !== "function") return;

      const hookFlag = "__upgraderEnhancementProgressHooked";
      if (window._g && window._g[hookFlag]) {
        state.enhancementProgressHooked = true;
        return;
      }

      const originalG = window._g;

      window._g = function (...args) {
        const request = args[0];
        const isEnhancementProgressRequest =
          typeof request === "string" &&
          request.includes("enhancement&action=progress&");

        const callbackIndex = args.findIndex(
          (arg, index) => index > 0 && typeof arg === "function"
        );

        const previewPoints = isEnhancementProgressRequest
          ? Utils.getEnhancePreviewPoints()
          : null;

        if (isEnhancementProgressRequest && callbackIndex !== -1) {
          const originalCallback = args[callbackIndex];

          args[callbackIndex] = function (...callbackArgs) {
            const responseData = callbackArgs[0];

            try {
              const isSuccess =
                responseData &&
                typeof responseData === "object" &&
                !responseData.error &&
                Boolean(responseData.enhancement);

              const progressLevel =
                responseData?.enhancement?.progressing?.upgradeLevel ?? "-";
              const usageCount =
                responseData?.enhancement?.usages_preview?.count ?? "-";
              const usageLimit =
                responseData?.enhancement?.usages_preview?.limit ?? "-";
              const eventKey = [
                String(request || ""),
                String(previewPoints || 0),
                String(progressLevel),
                String(usageCount),
                String(usageLimit),
              ].join("|");

              if (isSuccess && Runtime.isDuplicateProgressEvent(eventKey)) {
                return originalCallback.apply(this, callbackArgs);
              }

              if (isSuccess && Number.isFinite(previewPoints) && previewPoints > 0) {
                state.dailyEnhancePoints = Storage.addDailyEnhancePoints(previewPoints);
                Ui.refreshDailyEnhancePoints();

                if (state.enhancementRunSummary) {
                  state.enhancementRunSummary.totalPoints += previewPoints;
                  state.enhancementRunSummary.upgradeLevel = progressLevel;
                }

                if (!state.isEnhancing) {
                  message(
                    `Dodano +${Utils.formatPoints(previewPoints)} pkt ulepszenia.`
                  );
                }
              }
            } catch (error) {}

            return originalCallback.apply(this, callbackArgs);
          };
        }

        return originalG.apply(this, args);
      };

      window._g[hookFlag] = true;

      state.enhancementProgressHooked = true;
    },

    initSalvageMessageHook() {
      if (state.salvageMessageHooked) return;
      if (typeof window.message !== "function") return;

      const hookFlag = "__upgraderSalvageMessageHooked";
      if (window.message && window.message[hookFlag]) {
        state.salvageMessageHooked = true;
        return;
      }

      const originalMessage = window.message;

      window.message = function (...args) {
        const text = String(args[0] || "");
        const messageType = args[1];

        // Całkowicie blokuj komunikaty "Otrzymano:" z rozbijania
        if (text.startsWith("Otrzymano:")) {
          // Wyciągnij nazwę przedmiotu (wszystko po "Otrzymano: ")
          const itemText = text.replace(/^Otrzymano:\s*/, "").trim();
          
          // Zapisz przedmiot do tablicy jeśli jesteśmy w trakcie rozbijania
          if (itemText && state.isEnhancing) {
            state.salvageReceivedItems.push(itemText);
          }
          
          // Nie wywołuj oryginalnego komunikatu - całkowicie zablokuj wyświetlanie
          return;
        }

        // Dla pozostałych komunikatów wywołaj oryginalną funkcję
        return originalMessage.apply(this, args);
      };

      window.message[hookFlag] = true;
      state.salvageMessageHooked = true;
    },
  };

  const Bootstrap = {
    init() {
      try {
        if (!window.Engine.allInit) {
          setTimeout(Bootstrap.init, 500);
          return;
        }
      } catch (error) {
        setTimeout(Bootstrap.init, 500);
        return;
      }

      state.hotkeys = Storage.getHotkeys();
      state.autoSettings = Storage.getAutoSettings();
      state.boundSettings = Storage.getBoundSettings();
      state.mode = Storage.getMode();
      state.enhanceCounter = Storage.getEnhanceCounter();
      state.dailyEnhancePoints = Storage.getDailyEnhancePoints();
      state.launcherVisible = Storage.getLauncherVisibility();

      if (state.mode === "salvage") {
        const selectedRarities = Storage.getAllowedRarities();
        Storage.setAllowedRarities(
          selectedRarities.filter((rarity) => rarity !== "heroic")
        );
      }

      Runtime.initEnhancementProgressHook();
      Runtime.initSalvageMessageHook();
      Ui.setupCss();
      Ui.createGui();
      Automation.bindHotkey();
      Automation.startAutoEnhanceLoop();
      Automation.startEnhanceCounterSyncLoop();
      Ui.initItemContextMenu();
      Ui.markItemAsUpgraded();
    },
  };

  Bootstrap.init();
})();

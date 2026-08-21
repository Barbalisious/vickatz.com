/**
 * Web-chat widget - כפתור צף + פאנל שיחה, מדבר ישירות עם ה-backend הקיים
 * (/webchat/message ב-app/main.py), על אותו backend של הבוט בטלגרם/וואטסאפ
 * (FastAPI + Claude API + Supabase).
 *
 * מוטמע בכל דפי האתר (עברית ואנגלית) ע"י תג <script> יחיד לפני </body>.
 * לא תלוי בשום ספרייה חיצונית.
 *
 * מיקום מכוון: bottom-left (מול הבאנר של טלגרם שיושב ב-bottom-right) - זה
 * שלב ביניים מכוון: לפי מסמך_מסירה_עדכון_עברית_אנגלית_19_8.md, היררכיית
 * הערוצים (web-chat כ-CTA מרכזי, טלגרם לפוטר) מתעדכנת רק אחרי שה-widget
 * הזה גמור ומושלם - לא כאן.
 *
 * מזהה שיחה (session_id): מזהה אנונימי שנוצר בדפדפן ונשמר ב-localStorage,
 * מקביל ל-chat_id של טלגרם - אבל בלי שום פלטפורמה חיצונית שמנפיקה אותו.
 * היסטוריית ההודעות המוצגת נשמרת גם היא מקומית (localStorage) רק לצורך
 * המשכיות ויזואלית בין רענוני עמוד - היא *לא* נטענת מהשרת (אין endpoint
 * כזה כרגע); מקור האמת המלא נשמר בטבלת messages ב-Supabase.
 */
(function () {
  "use strict";

  // כתובת ה-backend המפורס (Render). אם משתנה בעתיד (דומיין מותאם אישית
  // וכו') - לעדכן כאן וגם ב-README של bot_server.
  var API_BASE = "https://robot-dinero-bot.onrender.com";
  var ENDPOINT = API_BASE + "/webchat/message";

  var STORAGE_SESSION_KEY = "vk_webchat_session_id";
  var STORAGE_HISTORY_KEY = "vk_webchat_history";
  var MAX_STORED_MESSAGES = 50;

  // Render בתוכנית החינמית "נרדם" אחרי חוסר פעילות - הבקשה הראשונה יכולה
  // לקחת 50 שניות ומעלה עד שהשרת מתעורר. אם אין תשובה תוך WAKEUP_HINT_MS,
  // מציגים למשתמשת רמז שזה בגלל זה, ולא שמשהו תקוע/שבור.
  var WAKEUP_HINT_MS = 6000;

  var isHebrew = (document.documentElement.lang || "").toLowerCase() !== "en";

  var STRINGS = isHebrew
    ? {
        launcherLabel: "שוחחו עם רובוט דינרו",
        title: "רובוט דינרו",
        placeholder: "כתבו הודעה...",
        send: "שליחה",
        welcome: "היי! אני רובוט דינרו 🤖 אפשר לשאול אותי כל שאלה על ויקי ומה שהיא עושה.",
        wakingUp: "השרת קצת ישן, מעיר אותו... זה יכול לקחת עד דקה בפעם הראשונה 🙂",
        error: "אופס, הייתה תקלה טכנית. אפשר לנסות שוב?",
        close: "סגירה",
      }
    : {
        launcherLabel: "Chat with Robot Dinero",
        title: "Robot Dinero",
        placeholder: "Type a message...",
        send: "Send",
        welcome: "Hi! I'm Robot Dinero 🤖 Ask me anything about Vicki and what she does.",
        wakingUp: "The server's waking up, this can take up to a minute the first time 🙂",
        error: "Oops, something went wrong on my end. Want to try again?",
        close: "Close",
      };

  function fallbackUuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getSessionId() {
    try {
      var id = localStorage.getItem(STORAGE_SESSION_KEY);
      if (!id) {
        id = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : fallbackUuid();
        localStorage.setItem(STORAGE_SESSION_KEY, id);
      }
      return id;
    } catch (e) {
      // localStorage לא זמין (מצב פרטי מחמיר וכו') - עדיין אפשר לשוחח,
      // רק בלי המשכיות בין רענוני עמוד.
      return fallbackUuid();
    }
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(STORAGE_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(
        STORAGE_HISTORY_KEY,
        JSON.stringify(history.slice(-MAX_STORED_MESSAGES))
      );
    } catch (e) {
      /* לא קריטי - אם השמירה נכשלת, פשוט אין המשכיות ברענון הבא */
    }
  }

  function buildLauncherIcon() {
    // אייקון "בועת שיחה" פשוט, באותו סגנון של שאר אייקוני הניווט באתר
    // (SVG חד-צבעי, fill="currentColor").
    var svgNs = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 -960 960 960");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "webchat-launcher-icon");
    var path = document.createElementNS(svgNs, "path");
    path.setAttribute(
      "d",
      "M240-400h480v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Z"
    );
    svg.appendChild(path);
    return svg;
  }

  function init() {
    var sessionId = getSessionId();
    var history = loadHistory();
    var sending = false;
    var typingEl = null;
    var panelOpen = false;

    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "webchat-launcher";
    launcher.setAttribute("aria-label", STRINGS.launcherLabel);
    launcher.appendChild(buildLauncherIcon());

    var panel = document.createElement("div");
    panel.className = "webchat-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", STRINGS.title);

    var header = document.createElement("div");
    header.className = "webchat-header";
    var headerTitle = document.createElement("span");
    headerTitle.textContent = STRINGS.title;
    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "webchat-close";
    closeBtn.setAttribute("aria-label", STRINGS.close);
    closeBtn.textContent = "✕";
    header.appendChild(headerTitle);
    header.appendChild(closeBtn);

    var messagesEl = document.createElement("div");
    messagesEl.className = "webchat-messages";
    messagesEl.setAttribute("role", "log");
    messagesEl.setAttribute("aria-live", "polite");

    var form = document.createElement("form");
    form.className = "webchat-form";
    var input = document.createElement("input");
    input.type = "text";
    input.className = "webchat-input";
    input.placeholder = STRINGS.placeholder;
    input.autocomplete = "off";
    var sendBtn = document.createElement("button");
    sendBtn.type = "submit";
    sendBtn.className = "webchat-send";
    sendBtn.textContent = STRINGS.send;
    form.appendChild(input);
    form.appendChild(sendBtn);

    panel.appendChild(header);
    panel.appendChild(messagesEl);
    panel.appendChild(form);

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    function renderMessage(role, text) {
      var bubble = document.createElement("div");
      bubble.className = "webchat-msg " + (role === "user" ? "webchat-msg-user" : "webchat-msg-bot");
      bubble.textContent = text;
      messagesEl.appendChild(bubble);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    if (history.length === 0) {
      // הודעת פתיחה מקומית בלבד - תצוגה נעימה, לא נשלחת/נשמרת בשרת (אין
      // כאן קריאת API, וגם לא נכנסת ל-history הנשמר).
      renderMessage("bot", STRINGS.welcome);
    } else {
      history.forEach(function (m) {
        renderMessage(m.role, m.text);
      });
    }

    function togglePanel(open) {
      panelOpen = open;
      panel.classList.toggle("webchat-panel-open", open);
      launcher.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        input.focus();
      }
    }

    launcher.addEventListener("click", function () {
      togglePanel(!panelOpen);
    });
    closeBtn.addEventListener("click", function () {
      togglePanel(false);
    });

    function showTyping(text) {
      hideTyping();
      typingEl = document.createElement("div");
      typingEl.className = "webchat-msg webchat-msg-bot webchat-typing";
      typingEl.textContent = text;
      messagesEl.appendChild(typingEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function hideTyping() {
      if (typingEl) {
        typingEl.remove();
        typingEl = null;
      }
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (!text || sending) {
        return;
      }

      sending = true;
      sendBtn.disabled = true;
      input.value = "";
      renderMessage("user", text);
      history.push({ role: "user", text: text });
      saveHistory(history);

      showTyping("…");
      var wakeupTimer = setTimeout(function () {
        showTyping(STRINGS.wakingUp);
      }, WAKEUP_HINT_MS);

      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, text: text }),
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("webchat_bad_status_" + response.status);
          }
          return response.json();
        })
        .then(function (data) {
          clearTimeout(wakeupTimer);
          hideTyping();
          var reply = data && data.reply ? data.reply : STRINGS.error;
          renderMessage("bot", reply);
          history.push({ role: "assistant", text: reply });
          saveHistory(history);
        })
        .catch(function () {
          clearTimeout(wakeupTimer);
          hideTyping();
          renderMessage("bot", STRINGS.error);
        })
        .finally(function () {
          clearTimeout(wakeupTimer);
          sending = false;
          sendBtn.disabled = false;
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

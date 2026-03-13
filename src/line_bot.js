// LINE Bot フル機能版（プレーンJavaScript - GAS対応）
// リッチメニュー対応 + 複数回答対応

function doGet() {
  return ContentService.createTextOutput("LINE Bot is running!");
}

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return ContentService.createTextOutput("OK");
  }

  try {
    var json = JSON.parse(e.postData.contents);
    var events = json.events;
    console.log("Webhook received. Event count: " + (events ? events.length : 0));

    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      if (event.type === 'message' && event.message.type === 'text') {
        var userMessage = event.message.text.trim();
        var replyToken = event.replyToken;
        var userId = event.source.userId;
        console.log("User(" + userId + ") sent: " + userMessage);

        if (userMessage === "問題出して" || userMessage === "クイズ") {
          sendRandomQuestion(replyToken, userId);
        } else if (userMessage === "管理者に連絡" || userMessage === "管理者へ") {
          replyMessage(replyToken, [{ "type": "text", "text": "担当者にお繋ぎします。少々お待ちください。" }]);
        } else if (userMessage.match(/^[1-5]$/)) {
          // 数字単体（回答用メニューからのタップを想定）
          handleSelection(replyToken, userId, userMessage);
        } else if (userMessage === "送信") {
          // 送信ボタン
          answerImmediately(replyToken, userId);
        } else if (userMessage.match(/[1-5]/)) {
          // 数字が含まれていれば（キーボード手入力など）
          // 既存の即時判定ロジックを呼ぶが、単一または複数まとめて送られた場合
          answerImmediately(replyToken, userId, userMessage);
        } else {
          var scheduleMatch = userMessage.match(/(\d+)時に(\d+)問出して/);
          if (scheduleMatch) {
            var targetHour = parseInt(scheduleMatch[1], 10);
            var questionCount = parseInt(scheduleMatch[2], 10);
            if (targetHour >= 0 && targetHour <= 23 && questionCount > 0 && questionCount <= 5) {
              registerSchedule(replyToken, userId, targetHour, questionCount);
            } else {
              replyMessage(replyToken, [{ "type": "text", "text": "時間は0〜23の間、問題数は1〜5問で指定してください。" }]);
            }
          } else {
            replyMessage(replyToken, [{
              "type": "text",
              "text": "使い方:\n📝 「問題を解く」で出題\n🔢 番号を送るだけで解答（複数回答は「12」や「1 3」のように）\n⏰ 「12時に3問出して」で予約"
            }]);
          }
        }
      }
    }
  } catch (err) {
    Logger.log("doPost error: " + err);
  }

  return ContentService.createTextOutput("OK");
}

// ランダムに問題を出題
function sendRandomQuestion(replyToken, userId) {
  var questions = questionData;
  var randomIndex = Math.floor(Math.random() * questions.length);
  var q = questions[randomIndex];

  if (!q || !q.options) return;

  var props = PropertiesService.getScriptProperties();
  props.setProperty("LAST_Q_" + userId, String(randomIndex)); // 出題した問題のインデックスを保存
  props.deleteProperty("SEL_" + userId); // 以前の選択状態をクリア

  var isMulti = q.isMultiSelect === true;

  var textMessage = "📝 問題\n\n";
  textMessage += q.text + "\n\n";
  for (var i = 0; i < q.options.length; i++) {
    textMessage += "[" + (i + 1) + "] " + q.options[i] + "\n";
  }

  if (isMulti) {
    textMessage += "\n🔢 複数選択して「送信」をタップしてね";
  } else {
    textMessage += "\n🔢 番号を選んで「送信」をタップしてね";
  }

  replyMessage(replyToken, [{ "type": "text", "text": textMessage }]);

  // 回答用リッチメニューに切り替え
  var quizMenuId = props.getProperty("QUIZ_RICH_MENU_ID");
  console.log("Attempting to link QUIZ_RICH_MENU_ID: " + quizMenuId + " to User: " + userId);
  if (quizMenuId) {
    linkRichMenuToUser(userId, quizMenuId);
  } else {
    console.log("QUIZ_RICH_MENU_ID が設定されていません。");
  }
}

// 選択状態の管理
function handleSelection(replyToken, userId, numStr) {
  var props = PropertiesService.getScriptProperties();
  var currentSel = props.getProperty("SEL_" + userId) || "";
  var selections = currentSel ? currentSel.split(",") : [];

  if (selections.indexOf(numStr) === -1) {
    selections.push(numStr);
    selections.sort();
    props.setProperty("SEL_" + userId, selections.join(","));
  }
}

// 数字入力または「送信」で判定
function answerImmediately(replyToken, userId, userMessage) {
  var props = PropertiesService.getScriptProperties();
  var lastQIndex = props.getProperty("LAST_Q_" + userId);

  if (lastQIndex === null) {
    replyMessage(replyToken, [{ "type": "text", "text": "まだ問題が出ていません。\n「問題を解く」をタップしてね！" }]);
    return;
  }

  var qIndex = parseInt(lastQIndex, 10);
  var questions = questionData;
  var q = questions[qIndex];

  // 判定材料の収集
  var nums = [];
  if (userMessage) {
    // 手入力の場合
    var matched = userMessage.match(/[1-5]/g);
    if (matched) nums = matched;
  } else {
    // 「送信」ボタンの場合（蓄積されたSELを使用）
    var savedSel = props.getProperty("SEL_" + userId) || "";
    if (savedSel) nums = savedSel.split(",");
  }

  if (nums.length === 0) {
    replyMessage(replyToken, [{ "type": "text", "text": "番号を選択してから「送信」してね！" }]);
    return;
  }

  var selected = [];
  for (var i = 0; i < nums.length; i++) {
    var val = parseInt(nums[i], 10);
    if (selected.indexOf(val) === -1) {
      selected.push(val);
    }
  }
  selected.sort();

  var resultMsg = "";

  if (q.isMultiSelect && q.correctIndices) {
    // 複数選択問題
    var userIndices = [];
    for (var i = 0; i < selected.length; i++) {
      userIndices.push(selected[i] - 1);
    }
    userIndices.sort();
    var correctSorted = q.correctIndices.slice().sort();

    var isCorrect = userIndices.length === correctSorted.length;
    if (isCorrect) {
      for (var j = 0; j < userIndices.length; j++) {
        if (userIndices[j] !== correctSorted[j]) {
          isCorrect = false;
          break;
        }
      }
    }

    if (isCorrect) {
      resultMsg = "⭕️ 完全正解です！\n\n";
    } else {
      var correctNums = [];
      for (var k = 0; k < q.correctIndices.length; k++) {
        correctNums.push(q.correctIndices[k] + 1);
      }
      resultMsg = "❌ 不正解！\n正解は [" + correctNums.join(", ") + "] です。\n\n";
    }
  } else if (q.correctIndex !== undefined) {
    // 単一選択問題の判定（最初の1文字だけ使う）
    var selectedIndex = selected[0] - 1;
    if (q.correctIndex === selectedIndex) {
      resultMsg = "⭕️ 正解です！\n\n";
    } else {
      resultMsg = "❌ 不正解！\n正解は [" + (q.correctIndex + 1) + "] です。\n\n";
    }
  } else {
    resultMsg = "正答判定ができませんでした。\n\n";
  }

  if (q.explanation) {
    resultMsg += "【解説】\n" + q.explanation;
  }

  resultMsg += "\n\n📝 次の問題は「問題を解く」をタップ！";

  props.deleteProperty("LAST_Q_" + userId);
  props.deleteProperty("SEL_" + userId);

  replyMessage(replyToken, [{ "type": "text", "text": resultMsg }]);

  // トップメニューに戻す
  unlinkRichMenuFromUser(userId);
}

// LINE Messaging API でリプライを送信
function replyMessage(replyToken, messages) {
  var LINE_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  if (!LINE_ACCESS_TOKEN) {
    Logger.log("LINE_ACCESS_TOKEN is not set.");
    return;
  }

  var url = 'https://api.line.me/v2/bot/message/reply';
  var payload = {
    'replyToken': replyToken,
    'messages': messages
  };

  var options = {
    'method': 'post',
    'headers': {
      'Content-Type': 'application/json; charset=UTF-8',
      'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN
    },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  UrlFetchApp.fetch(url, options);
}

// リッチメニューの紐付け
function linkRichMenuToUser(userId, richMenuId) {
  var LINE_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  var url = "https://api.line.me/v2/bot/user/" + userId + "/richmenu/" + richMenuId;
  var options = {
    "method": "post",
    "headers": {
      "Authorization": "Bearer " + LINE_ACCESS_TOKEN
    },
    "muteHttpExceptions": true
  };
  var res = UrlFetchApp.fetch(url, options);
  var body = res.getContentText();
  PropertiesService.getScriptProperties().setProperty("LAST_API_ERROR", body); // エラー情報をプロパティに保存
  console.log("Link Rich Menu Body: " + body);
  return res;
}

// リッチメニューの紐付け解除
function unlinkRichMenuFromUser(userId) {
  var LINE_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  var url = "https://api.line.me/v2/bot/user/" + userId + "/richmenu";
  var options = {
    "method": "delete",
    "headers": {
      "Authorization": "Bearer " + LINE_ACCESS_TOKEN
    },
    "muteHttpExceptions": true
  };
  var res = UrlFetchApp.fetch(url, options);
  var body = res.getContentText();
  PropertiesService.getScriptProperties().setProperty("LAST_API_ERROR", body); // エラー情報をプロパティに保存
  console.log("Unlink Rich Menu Body: " + body);
  return res;
}

// --- デバッグ用ツール (GASエディタから実行してログを確認してください) ---

function debugCheckProperties() {
  var props = PropertiesService.getScriptProperties().getProperties();
  console.log("--- 現在設定されているプロパティ ---");
  console.log("LINE_ACCESS_TOKEN: " + (props.LINE_ACCESS_TOKEN ? "設定済み" : "❌ 未設定"));
  console.log("TOP_RICH_MENU_ID: " + (props.TOP_RICH_MENU_ID || "❌ 未設定"));
  console.log("QUIZ_RICH_MENU_ID: " + (props.QUIZ_RICH_MENU_ID || "❌ 未設定"));
  console.log("LAST_API_ERROR: " + (props.LAST_API_ERROR || "なし"));
  console.log("-------------------------------");
}

// 自分自身のメニューを強制的に回答用にするテスト
function debugLinkQuizMenuToMe() {
  var props = PropertiesService.getScriptProperties();
  var quizId = props.getProperty("QUIZ_RICH_MENU_ID");
  // ログに出力された自分のuserIdをここに入れてテストも可能です
  // もしくは最近イベントを送ったuserIdを自動取得するロジックが必要ですが、
  // ひとまずは設定値のチェックとAPIの疎通確認を目的とします。
  Logger.log("回答用メニューID: " + quizId);
  if (!quizId) {
    Logger.log("❌ QUIZ_RICH_MENU_ID が設定されていません。");
    return;
  }
  // ※ userIdが判明している場合は、直接引数に入れて linkRichMenuToUser('あなたのID', quizId) を実行してください。
}

// 登録されている全てのリッチメニューIDをログに出力する
function debugListAllRichMenus() {
  var LINE_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  var url = "https://api.line.me/v2/bot/richmenu/list";
  var options = {
    "method": "get",
    "headers": {
      "Authorization": "Bearer " + LINE_ACCESS_TOKEN
    },
    "muteHttpExceptions": true
  };

  var res = UrlFetchApp.fetch(url, options);
  var data = JSON.parse(res.getContentText());

  console.log("--- 登録されているリッチメニュー一覧 ---");
  if (data.richmenus && data.richmenus.length > 0) {
    data.richmenus.forEach(function (m) {
      console.log("名前: " + m.name);
      console.log("ID: " + m.richMenuId);
      console.log("チャットバー: " + m.chatBarText);
      console.log("-------------------------------");
    });
  } else {
    console.log("リッチメニューが見つかりませんでした。");
  }
}

// 登録されている全てのリッチメニューを一括削除する（リセット用）
function debugDeleteAllRichMenus() {
  var LINE_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  var listUrl = "https://api.line.me/v2/bot/richmenu/list";
  var options = {
    "method": "get",
    "headers": { "Authorization": "Bearer " + LINE_ACCESS_TOKEN },
    "muteHttpExceptions": true
  };

  var res = UrlFetchApp.fetch(listUrl, options);
  var data = JSON.parse(res.getContentText());

  if (data.richmenus && data.richmenus.length > 0) {
    data.richmenus.forEach(function (m) {
      var deleteUrl = "https://api.line.me/v2/bot/richmenu/" + m.richMenuId;
      UrlFetchApp.fetch(deleteUrl, {
        "method": "delete",
        "headers": { "Authorization": "Bearer " + LINE_ACCESS_TOKEN },
        "muteHttpExceptions": true
      });
      console.log("削除完了: " + m.name + " (" + m.richMenuId + ")");
    });
    console.log("--- 全てのメニューの削除を試行しました ---");
  } else {
    console.log("削除対象が見つかりませんでした。");
  }
}

// 現在のボット自身の情報を表示する
function debugBotInfo() {
  var LINE_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  var url = "https://api.line.me/v2/bot/info";
  var options = {
    "method": "get",
    "headers": { "Authorization": "Bearer " + LINE_ACCESS_TOKEN },
    "muteHttpExceptions": true
  };

  var res = UrlFetchApp.fetch(url, options);
  var data = JSON.parse(res.getContentText());

  console.log("--- 操作中のボット情報 ---");
  console.log("ボット名: " + data.displayName);
  console.log("ボットID (Basic ID): " + data.basicId);
  console.log("プレミアムID: " + (data.premiumId || "なし"));
  console.log("-------------------------------");
}

// --- リッチメニュー完全登録ツール (ドライブの画像を使用) ---

// 1. まずこれを実行
function setupQuizMenuShell() {
  createQuizRichMenu(); // 前に作った関数を呼び出し
}

// 2. 次に、ドライブの画像IDを "" の中に入れてを実行してください
function uploadQuizMenuImageFromDrive() {
  var props = PropertiesService.getScriptProperties();
  var menuId = props.getProperty("QUIZ_RICH_MENU_ID");
  var fileId = ""; // ここに Google ドライブのファイルIDを貼り付けてください

  if (menuId && fileId !== "") {
    var res = uploadRichMenuImageFromDrive(menuId, fileId);
    console.log("アップロード結果: " + res.getContentText());
  } else {
    console.log("エラー: 既存のQUIZ_RICH_MENU_IDがないか、ファイルIDが未入力です。");
  }
}

function uploadTopMenuImageFromDrive() {
  var props = PropertiesService.getScriptProperties();
  var menuId = props.getProperty("TOP_RICH_MENU_ID");
  var fileId = ""; // ここに Google ドライブのファイルIDを貼り付けてください

  if (menuId && fileId !== "") {
    var res = uploadRichMenuImageFromDrive(menuId, fileId);
    console.log("アップロード結果: " + res.getContentText());
  } else {
    console.log("エラー: 既存のTOP_RICH_MENU_IDがないか、ファイルIDが未入力です。");
  }
}

// 共通ヘルパー: ドライブから画像を読み込んでLINEにアップロード
function uploadRichMenuImageFromDrive(richMenuId, fileId) {
  var LINE_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  var imageBlob = DriveApp.getFileById(fileId).getBlob();
  var bytes = imageBlob.getBytes();

  var url = "https://api-data.line.me/v2/bot/richmenu/" + richMenuId + "/content";
  var options = {
    "method": "post",
    "headers": {
      "Authorization": "Bearer " + LINE_ACCESS_TOKEN,
      "Content-Type": "image/png"
    },
    "payload": bytes,
    "muteHttpExceptions": true
  };

  var res = UrlFetchApp.fetch(url, options);
  PropertiesService.getScriptProperties().setProperty("LAST_API_ERROR", res.getContentText());
  return res;
}
// 錬成試験（トップ）リッチメニューの登録
function createRichMenu() {
  var LINE_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");

  var richMenuBody = {
    "size": { "width": 2500, "height": 1686 },
    "selected": true,
    "name": "錬成試験メニュー (新レイアウト)",
    "chatBarText": "メニューを開く",
    "areas": [
      {
        "bounds": { "x": 0, "y": 0, "width": 1667, "height": 1686 },
        "action": { "type": "message", "text": "問題出して" }
      },
      {
        "bounds": { "x": 1667, "y": 0, "width": 833, "height": 843 },
        "action": { "type": "uri", "uri": "https://example.com/app" }
      },
      {
        "bounds": { "x": 1667, "y": 843, "width": 833, "height": 843 },
        "action": { "type": "message", "text": "管理者に連絡" }
      }
    ]
  };

  var url = "https://api.line.me/v2/bot/richmenu";
  var options = {
    "method": "post",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + LINE_ACCESS_TOKEN
    },
    "payload": JSON.stringify(richMenuBody),
    "muteHttpExceptions": true
  };

  var res = UrlFetchApp.fetch(url, options);
  var result = JSON.parse(res.getContentText());
  var richMenuId = result.richMenuId;

  if (richMenuId) {
    PropertiesService.getScriptProperties().setProperty("TOP_RICH_MENU_ID", richMenuId);
    console.log("Created Top Rich Menu ID: " + richMenuId);
  } else {
    console.log("Error createRichMenu: " + res.getContentText());
  }
}

// 回答用リッチメニューの登録
function createQuizRichMenu() {
  var LINE_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");

  var richMenuBody = {
    "size": { "width": 2500, "height": 1686 },
    "selected": false,
    "name": "回答用メニュー (1〜5・送信)",
    "chatBarText": "解答する",
    "areas": [
      { "bounds": { "x": 0, "y": 0, "width": 833, "height": 843 }, "action": { "type": "message", "text": "1" } },
      { "bounds": { "x": 833, "y": 0, "width": 833, "height": 843 }, "action": { "type": "message", "text": "2" } },
      { "bounds": { "x": 1666, "y": 0, "width": 834, "height": 843 }, "action": { "type": "message", "text": "3" } },
      { "bounds": { "x": 0, "y": 843, "width": 833, "height": 843 }, "action": { "type": "message", "text": "4" } },
      { "bounds": { "x": 833, "y": 843, "width": 833, "height": 843 }, "action": { "type": "message", "text": "5" } },
      { "bounds": { "x": 1666, "y": 843, "width": 834, "height": 843 }, "action": { "type": "message", "text": "送信" } }
    ]
  };

  var url = "https://api.line.me/v2/bot/richmenu";
  var options = {
    "method": "post",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + LINE_ACCESS_TOKEN
    },
    "payload": JSON.stringify(richMenuBody),
    "muteHttpExceptions": true
  };

  var res = UrlFetchApp.fetch(url, options);
  var result = JSON.parse(res.getContentText());
  var richMenuId = result.richMenuId;

  if (richMenuId) {
    PropertiesService.getScriptProperties().setProperty("QUIZ_RICH_MENU_ID", richMenuId);
    Logger.log("Created Quiz Rich Menu ID: " + richMenuId);
    Logger.log("✅ 回答用リッチメニュー作成完了！画像をアップロードしてください。");
  } else {
    Logger.log("Error: " + res.getContentText());
  }
}

// --- スケジュール出題関連 ---

function registerSchedule(replyToken, userId, hour, count) {
  var props = PropertiesService.getScriptProperties();
  var schedulesJson = props.getProperty("SCHEDULES") || "{}";
  var schedules = JSON.parse(schedulesJson);

  schedules[userId] = { hour: hour, count: count };
  props.setProperty("SCHEDULES", JSON.stringify(schedules));

  replyMessage(replyToken, [{ "type": "text", "text": "🕒 承知しました！毎日 " + hour + "時台 に " + count + "問 出題しますね！" }]);
}

function checkScheduledRequests() {
  var props = PropertiesService.getScriptProperties();
  var schedulesJson = props.getProperty("SCHEDULES") || "{}";
  var schedules = JSON.parse(schedulesJson);
  var LINE_ACCESS_TOKEN = props.getProperty("LINE_ACCESS_TOKEN");

  if (!LINE_ACCESS_TOKEN || Object.keys(schedules).length === 0) return;

  var currentHour = new Date().getHours();

  for (var userId in schedules) {
    var userSched = schedules[userId];
    if (userSched.hour === currentHour) {
      sendScheduledQuestions(userId, userSched.count, LINE_ACCESS_TOKEN);
    }
  }
}

function sendScheduledQuestions(userId, count, accessToken) {
  var questions = questionData;
  var pushMessages = [];
  var targetCount = count > 5 ? 5 : count;
  var props = PropertiesService.getScriptProperties();
  var lastIndex = 0;

  pushMessages.push({
    "type": "text",
    "text": "⏰ 時間になりました！" + targetCount + "問 出題します。"
  });

  for (var c = 0; c < targetCount; c++) {
    var randomIndex = Math.floor(Math.random() * questions.length);
    var q = questions[randomIndex];

    if (!q || !q.options) continue;

    lastIndex = randomIndex;
    var isMulti = q.isMultiSelect === true;
    var textMessage = "Q" + (c + 1) + ". " + q.text + "\n\n";
    for (var i = 0; i < q.options.length; i++) {
      textMessage += "[" + (i + 1) + "] " + q.options[i] + "\n";
    }
    if (isMulti) {
      textMessage += "\n🔢 複数選択OK！";
    }

    if (pushMessages.length < 5) {
      pushMessages.push({ "type": "text", "text": textMessage });
    }
  }

  props.setProperty("LAST_Q_" + userId, String(lastIndex));
  props.deleteProperty("SEL_" + userId);

  var url = 'https://api.line.me/v2/bot/message/push';
  var payload = {
    'to': userId,
    'messages': pushMessages
  };

  var options = {
    'method': 'post',
    'headers': {
      'Content-Type': 'application/json; charset=UTF-8',
      'Authorization': 'Bearer ' + accessToken
    },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  UrlFetchApp.fetch(url, options);
}

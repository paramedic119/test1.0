// 最小限のテスト用コード（問題データを使わず、基本的な返信のみ）

function doGet() {
    return ContentService.createTextOutput("LINE Bot is running!");
}

function doPost(e: GoogleAppsScript.Events.DoPost) {
    if (!e || !e.postData || !e.postData.contents) {
        return ContentService.createTextOutput("OK");
    }

    try {
        var json = JSON.parse(e.postData.contents);
        var events = json.events;

        for (var i = 0; i < events.length; i++) {
            var event = events[i];
            if (event.type === 'message' && event.message.type === 'text') {
                var replyToken = event.replyToken;
                var userText = event.message.text;

                // とにかく何か返す（テスト用）
                var LINE_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
                if (!LINE_ACCESS_TOKEN) {
                    Logger.log("TOKEN NOT SET");
                    return ContentService.createTextOutput("OK");
                }

                var url = 'https://api.line.me/v2/bot/message/reply';
                var payload = {
                    'replyToken': replyToken,
                    'messages': [
                        {
                            'type': 'text',
                            'text': 'テスト成功！受信したメッセージ: ' + userText
                        }
                    ]
                };

                var options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
                    'method': 'post',
                    'headers': {
                        'Content-Type': 'application/json; charset=UTF-8',
                        'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN
                    },
                    'payload': JSON.stringify(payload),
                    'muteHttpExceptions': true
                };

                var result = UrlFetchApp.fetch(url, options);
                Logger.log("LINE API Response: " + result.getContentText());
            }
        }
    } catch (err) {
        Logger.log("Error: " + err);
    }

    return ContentService.createTextOutput("OK");
}

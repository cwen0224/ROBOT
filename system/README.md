# ROBOT Node Editor

這個資料夾現在是主要開發區，使用 LiteGraph.js 做成可拖曳、可拉線的 node editor。

## 主要功能

- 左側會自動載入 `expressions` 資料夾中的預設表情
- 點一下即可把表情建立成節點
- 中間畫布可用滑鼠拖曳、連線、重新排列節點
- 右側可調整節點參數
- Export 會把連到輸出節點的 expression 依時間取樣後加總，轉成 `MOTION3`

## 借用的開源專案

- [LiteGraph.js](https://github.com/jagenjo/litegraph.js)
- 它是一個 MIT 授權的 JavaScript node graph/editor，適合拿來做拖線式節點編輯器

## 使用方式

1. 打開 `index.html`
2. 等待預設表情清單載入
3. 將表情節點加入畫布，連到 Mixer 與 Export
4. 按 `匯出 MOTION3`

## 匯入自訂表情

- 可以直接匯入 `.exp3.json`
- 或把整個 `expressions` 資料夾拖進檔案選擇器

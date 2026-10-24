const fs = require("fs");
const path = "E:/antigravty/billing software/ps-app/src/renderer/src/pages/ReceiptDesigner.tsx";
let content = fs.readFileSync(path, "utf-8");
content = content.replace(/defaultDocumentDesign('\"thermal80\")/g, "defaultDocumentDesign(\"receipt\", \"thermal80\")");
content = content.replace(/defaultDocumentDesign(paper)/g, "defaultDocumentDesign(documentType, paper)");
fs.writeFileSync(path, content, "utf-8");
console.log("File fixed successfully");
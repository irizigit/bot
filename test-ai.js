require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

// كنجبدو المفتاح
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error("❌ الـ API KEY ماكاينش! تأكد من ملف .env");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function test() {
    console.log("⏳ جاري الاتصال بجوجل...");
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("مرحبا، واش كتفهمني؟ جاوبني بالدارجة المغريبة فسطر واحد.");
        console.log("✅ الذكاء الاصطناعي خدام مزيان! الجواب ديالو:");
        console.log("🤖:", result.response.text());
    } catch (error) {
        console.error("❌ وقع خطأ:", error.message);
    }
}

test();

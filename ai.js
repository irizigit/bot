require('dotenv').config(); // هاد السطر ضروري باش يقرا الـ API KEY
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getAIResponse(userMessage, userName, availableLecturesText) {
    try {
        // الموديل الصحيح والأسرع حالياً
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash", 
        });

        const systemInstruction = `أنت مساعد أكاديمي ذكي ولطيف اسمه "IRIZI Bot"، مبرمج من طرف المطور "IRIZI".
مهمتك مساعدة طلبة كلية الآداب والعلوم الإنسانية (بني ملال - المغرب).
تتحدث بالدارجة المغربية بأسلوب محترم، ودود، ومختصر جداً.

💡 **طريقة عملك والأوامر:**
- لمعرفة النقط والنتائج وتبرير الغياب: !فحص
- للبحث عن المحاضرات: !تحميل
- للحصول على دليل الاستخدام: !دليل

📚 **الملفات المتوفرة حاليا:**
${availableLecturesText}

⚠️ **قاعدة الرد:** إذا كان الكلام عاديا بين الطلبة أو لا يتطلب مساعدة، رد بكلمة واحدة فقط: IGNORE. إذا طلبوا مساعدة أجبهم بالدارجة وساعدهم.`;

        const prompt = `${systemInstruction}\n\nالطالب "${userName}" يقول: ${userMessage}`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        return text.trim();
        
    } catch (error) {
        console.error("AI Error Details:", error.message);
        return 'IGNORE'; 
    }
}

module.exports = { getAIResponse };

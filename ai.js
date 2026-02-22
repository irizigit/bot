const { GoogleGenerativeAI } = require("@google/generative-ai");

// تأكد أن GEMINI_API_KEY موجود في ملف .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getAIResponse(userMessage, userName, availableLecturesText) {
    try {
        // التعديل هنا: نستخدم الموديل 'gemini-1.5-flash' بشكل مباشر
     const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash-latest", 
});

        const systemInstruction = `أنت مساعد أكاديمي ذكي ولطيف اسمه "IRIZI Bot"، مبرمج من طرف المطور "IRIZI".
            مهمتك مساعدة طلبة كلية الآداب والعلوم الإنسانية (بني ملال - المغرب).
            تتحدث بالدارجة المغربية بأسلوب محترم، ودود، ومختصر جداً.

            💡 **طريقة عملك والأوامر التي يجب أن تشرحها للطلبة:**
            - لمعرفة النقط والنتائج: !فحص
            - للبحث عن المحاضرات: !تحميل
            - للحصول على دليل الاستخدام: !دليل

            📚 **الملفات المتوفرة:**
            ${availableLecturesText}

            ⚠️ **قاعدة الرد:** إذا كان الكلام عادياً بين الطلبة رد بكلمة واحدة: IGNORE. إذا طلبوا مساعدة أجبهم بالدارجة.`;

        // دمج التعليمات مع الرسالة لضمان عملها في النسخ المختلفة
        const prompt = `${systemInstruction}\n\nالطالب "${userName}" يقول: ${userMessage}`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        return text.trim();
        
    } catch (error) {
        // إذا كان الخطأ بسبب الموديل، جرب استخدام اسم الموديل الكامل
        console.error("AI Error Details:", error.message);
        return 'IGNORE'; 
    }
}

module.exports = { getAIResponse };

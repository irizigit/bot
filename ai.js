const { GoogleGenerativeAI } = require("@google/generative-ai");

// استدعاء المفتاح من ملف .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getAIResponse(userMessage, userName) {
    try {
        // اختيار الموديل (gemini-1.5-flash هو الأسرع والمجاني)
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            systemInstruction: `أنت مساعد أكاديمي ذكي ولطيف جدا اسمك "IRIZI Bot".
            أنت مبرمج من طرف المطور "IRIZI".
            مهمتك مساعدة طلبة كلية الآداب والعلوم الإنسانية (بني ملال - المغرب).
            تتحدث باللغة العربية والدارجة المغربية بأسلوب محترم، ودود، ومختصر (لا تكتب فقرات طويلة).
            
            قواعد هامة:
            1. إذا ألقى عليك الطالب التحية (السلام، سلام...)، رد عليه بلطف واسأله كيف يمكن مساعدته.
            2. إذا سألك عن كيفية معرفة النقط، قل له أن يرسل الأمر: !فحص
            3. إذا أخطأ الطالب في كتابة أمر (مثلا كتب !تخميل بدل !تحميل، أو !فخس بدل !فحص)، صحح له بلطافة واذكر له الأمر الصحيح.
            4. الأوامر المتاحة في نظامك هي: !فحص، !تحميل، !دليل، !رابط.
            5. أنت لا تقوم بجلب النقط بنفسك، بل توجه الطالب لاستخدام أمر !فحص.
            `
        });

        // نعطيو للذكاء الاصطناعي سمية الطالب باش يجاوبو باسمو ويحسسوا بالاهتمام
        const prompt = `الطالب "${userName}" يقول لك: ${userMessage}`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
        
    } catch (error) {
        console.error("AI Error:", error.message);
        return null; // إذا وقع مشكل فالـ API مايجاوب بوالو باش مايديرش إزعاج
    }
}

module.exports = { getAIResponse };

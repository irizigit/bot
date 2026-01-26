// gemini-service.js

const fetch = require('node-fetch');
const { GEMINI_API_KEY } = require('./config');

/**
 * @description يرسل طلبًا عامًا إلى Gemini API للحصول على إجابة.
 * @param {string} prompt - النص أو السؤال المراد إرساله.
 * @param {string} [context=''] - سياق إضافي للمساعدة في توليد الإجابة.
 * @returns {Promise<string>} الإجابة النصية من Gemini.
 */
async function askGemini(prompt, context = '') {
    try {
        const fullPrompt = context ? `${context}\n\nالسؤال: ${prompt}` : prompt;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: fullPrompt }] }]
            })
        });

        const data = await response.json();

        if (data && data.candidates && data.candidates.length > 0) {
            return data.candidates[0].content.parts[0].text;
        } else {
            // يوفر رسالة خطأ أكثر تفصيلاً للمطور
            console.error('[❌] Invalid response structure from Gemini API:', JSON.stringify(data, null, 2));
            return "عذراً، لم أتمكن من الحصول على إجابة من الذكاء الاصطناعي.";
        }
    } catch (error) {
        console.error('[❌] Error calling Gemini API:', error);
        return "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي.";
    }
}

/**
 * @description يحلل نية المستخدم من رسالته باستخدام Gemini.
 * @param {string} message - رسالة المستخدم.
 * @param {string} senderName - اسم المرسل.
 * @param {boolean} isGroup - هل الرسالة من مجموعة.
 * @param {string} [groupName=''] - اسم المجموعة.
 * @returns {Promise<Object>} كائن JSON يحتوي على النية، الرد، الإجراء، ومستوى الثقة.
 */
async function analyzeUserIntent(message, senderName, isGroup, groupName = '') {
    const context = `
أنت مساعد ذكاء اصطناعي لبوت WhatsApp. مهمتك هي تحليل نية المستخدم من رسالته والرد بشكل مناسب.

المعلومات المتاحة:
- اسم المرسل: ${senderName}
- الرسالة من مجموعة: ${isGroup ? 'نعم' : 'لا'}
${isGroup ? `- اسم المجموعة: ${groupName}` : ''}
- الرسالة: ${message}

الرد يجب أن يكون بتنسيق JSON يحتوي على:
{
  "intent": "النية (مثل: سؤال، شكوى، طلب مساعدة، إلخ)",
  "response": "الرد المناسب للمستخدم",
  "action": "إجراء يجب على البوت اتخاذه (مثل: none, notify_admin, add_to_blacklist, إلخ)",
  "confidence": "مستوى الثقة (من 0 إلى 1)"
}
`;

    const aiResponse = await askGemini(`حلل نية المستخدم من هذه الرسالة ورد بشكل مناسب.`, context);
    
    try {
        // تنظيف الاستجابة من أي علامات كود إضافية قد يرسلها النموذج
        const cleanResponse = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanResponse);
    } catch (parseError) {
        console.error('[❌] Error parsing AI response for intent analysis:', parseError, "Original response:", aiResponse);
        return {
            intent: "unknown",
            response: "عذراً، لم أفهم رسالتك. هل يمكنك توضيح ما تحتاجه؟",
            action: "none",
            confidence: 0.2
        };
    }
}

/**
 * @description يقوم بإنشاء رسالة ترحيب مخصصة لعضو جديد.
 * @param {string} userName - اسم العضو الجديد.
 * @param {string} groupName - اسم المجموعة.
 * @returns {Promise<string>} رسالة الترحيب.
 */
async function generateWelcomeMessage(userName, groupName) {
    const context = `
أنت مساعد ذكاء اصطناعي لبوت WhatsApp. مهمتك هي إنشاء رسالة ترحيب دافئة وودية لعضو جديد في المجموعة.

المعلومات المتاحة:
- اسم العضو الجديد: ${userName}
- اسم المجموعة: ${groupName}

الرد يجب أن يكون رسالة ترحيب قصيرة ودافئة، لا تزيد عن 3 أسطر.
`;

    try {
        return await askGemini(`أنشئ رسالة ترحيب للعضو الجديد.`, context);
    } catch (error) {
        console.error('[❌] Error generating welcome message:', error);
        // رسالة احتياطية في حال فشل الذكاء الاصطناعي
        return `مرحباً ${userName} في مجموعة ${groupName}! 🎉`;
    }
}

module.exports = {
    askGemini,
    analyzeUserIntent,
    generateWelcomeMessage,
};
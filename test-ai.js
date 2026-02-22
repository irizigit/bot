require('dotenv').config();

async function checkModels() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error("❌ الـ API KEY ماكاينش فملف .env");
        return;
    }

    console.log("⏳ جاري فحص الموديلات المتاحة للمفتاح ديالك...");
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (data.models) {
            console.log("\n✅ الموديلات اللي مسموح ليك تخدم بيها هي:");
            data.models.forEach(model => {
                // غنطبعو غير الموديلات اللي كتدعم إنشاء النصوص
                if (model.supportedGenerationMethods.includes("generateContent")) {
                    console.log(`- ${model.name}`);
                }
            });
            console.log("\n💡 (نسخ واحد من هاد السميات وقولها ليا باش نخدمو بيه)");
        } else {
            console.error("❌ جوجل رجعات هاد الخطأ:", data);
        }
    } catch (error) {
        console.error("❌ فشل الاتصال بجوجل:", error.message);
    }
}

checkModels();

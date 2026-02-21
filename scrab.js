const puppeteer = require('puppeteer');

/**
 * دالة لجلب معلومات الطالب من موقع الكلية
 * @param {string} apogee - رقم الأبوجي
 * @param {string} cin - رقم بطاقة التعريف الوطنية
 * @param {string} birthDate - تاريخ الازدياد (YYYY-MM-DD)
 */
async function getStudentInfo(apogee, cin, birthDate) {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    const page = await browser.newPage();
    
    try {
        // الدخول للموقع
        await page.goto('https://web.flshbm.ma/', { waitUntil: 'networkidle2', timeout: 60000 });

        // إدخال البيانات
        await page.type('input[name="apogee"]', apogee);
        await page.type('input[name="cin"]', cin);
        await page.type('input[name="date_naissance"]', birthDate);

        // الضغط على زر الإرسال والانتظار حتى تحميل الصفحة التالية
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
        ]);

        // استخراج النص من الصفحة (يمكن تعديل الـ Selector بناءً على ما يظهر في الصورة)
        const resultText = await page.evaluate(() => {
            // نحاول جلب محتوى الكارط أو الجدول الذي يظهر فيه الاسم والمعلومات
            const mainContent = document.querySelector('.card-body') || document.querySelector('main') || document.body;
            return mainContent ? mainContent.innerText.trim() : "تعذر قراءة محتوى الصفحة";
        });

        await browser.close();
        
        if (resultText.includes("خطأ") || resultText.length < 10) {
            return "❌ المعلومات المدخلة غير صحيحة أو لا يوجد سجل لهذا الطالب.";
        }

        return `✅ *نتائج الفحص من الموقع:* \n\n${resultText}`;

    } catch (error) {
        console.error('Scraping Error:', error);
        await browser.close();
        return "❌ حدث خطأ أثناء الاتصال بالموقع، يرجى المحاولة لاحقاً.";
    }
}

module.exports = { getStudentInfo };

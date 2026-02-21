const puppeteer = require('puppeteer');

async function getStudentInfo(apogee, cin, birthDate) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        // الدخول للموقع
        await page.goto('https://web.flshbm.ma/', { waitUntil: 'networkidle2', timeout: 45000 });
        
        // الانتظار 4 ثواني للتأكد من تحميل كل السكريبتات في الموقع
        await new Promise(r => setTimeout(r, 4000));

        // طريقة ذكية للبحث عن الخانات وتعبئتها وتخطي مشكل الـ Selector
        const isFormSubmitted = await page.evaluate((ap, c, bd) => {
            // محاولة إيجاد الخانات بالاسم أو بالنوع كبديل
            let apogeeInput = document.querySelector('input[name="apogee"]') || document.querySelector('input[placeholder*="Apogee" i]') || document.querySelectorAll('input[type="text"]')[0];
            let cinInput = document.querySelector('input[name="cin"]') || document.querySelector('input[placeholder*="CIN" i]') || document.querySelectorAll('input[type="text"]')[1];
            let dateInput = document.querySelector('input[name="date_naissance"]') || document.querySelector('input[type="date"]') || document.querySelectorAll('input')[2]; // غالبا الخانة الثالثة
            let submitBtn = document.querySelector('button[type="submit"]') || document.querySelector('input[type="submit"]') || document.querySelector('.btn');

            if (apogeeInput && cinInput && dateInput && submitBtn) {
                apogeeInput.value = ap;
                cinInput.value = c;
                dateInput.value = bd;
                submitBtn.click();
                return true;
            }
            return false; // لم يتم العثور على الخانات
        }, apogee, cin, birthDate);

        if (!isFormSubmitted) {
            await browser.close();
            return "❌ عذراً، لم أتمكن من العثور على خانات التسجيل في الموقع. قد يكون الموقع تحت الصيانة أو تم تغيير تصميمه.";
        }

        // انتظار تحميل صفحة النتيجة بعد الضغط على الزر
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 });

        // استخراج النتيجة
        const resultText = await page.evaluate(() => {
            const card = document.querySelector('.card-body') || document.querySelector('main') || document.body;
            return card ? card.innerText.trim() : "لا توجد بيانات";
        });

        await browser.close();
        
        if (!resultText || resultText.includes("خطأ")) {
            return "❌ المعلومات المدخلة غير صحيحة أو لا يوجد سجل لهذا الطالب.";
        }

        return `✅ *نتائج الفحص:* \n\n${resultText}`;

    } catch (error) {
        console.error('Scraping Error:', error.message);
        await browser.close();
        
        // إرجاع رسالة نصية عادية توضح المشكل بدون كائنات (Objects)
        return `❌ حدث خطأ أثناء الاتصال بالموقع.\nالسبب: ${error.message}`;
    }
}

module.exports = { getStudentInfo };

const { Buttons } = require('whatsapp-web.js');

async function sendPoll(message) {
    const pollQuestion = "📊 ما رأيك في وقت المحاضرة الجديد؟";
    const options = [
        { body: "ممتاز ✅" },
        { body: "مقبول 🙂" },
        { body: "غير مناسب ❌" }
    ];

    const buttons = new Buttons(pollQuestion, options, "اختر خيارًا:", "Poll Bot");
    await message.reply(buttons);
}

// يولد رقم بطاقة عشوائي يمر بفحص Luhn — للاختبار فقط
function luhnCheckDigit(digits) {
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (double) {
      d = d * 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  const check = (10 - (sum % 10)) % 10;
  return check;
}

function generateCardNumber(prefix = "400000", length = 16) {
  // prefix: بداية رقم البطاقة (مثلاً 4 للـ Visa). طول نهائي عادة 16.
  let number = prefix;
  while (number.length < length - 1) {
    number += Math.floor(Math.random() * 10).toString();
  }
  const check = luhnCheckDigit(number);
  return number + check.toString();
}

// مثال:
console.log(generateCardNumber("424242", 16)); // رقم اختبار (لا تستخدمه في مدفوعات حقيقية)

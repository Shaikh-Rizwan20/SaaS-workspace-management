const nodemailer = require('nodemailer');

const sendEmail = async (to, subject, htmlContent) => {
    try {
        console.log("\n========================================");
        console.log("MOCK EMAIL DISPATCHED (Development Mode)");
        console.log(`To: ${to}`);
        console.log(`Subject: ${subject}`);
        console.log("Content:");
        console.log(htmlContent.replace(/<[^>]*>?/gm, '')); // Strip HTML tags for readable console log
        console.log("========================================\n");

        return true;
    } catch (err) {
        console.error("Error sending email:", err);
        return false;
    }
};

exports.sendEmail = sendEmail;
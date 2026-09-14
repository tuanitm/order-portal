import nodemailer from "nodemailer";
import { readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

interface EmailConfig {
  smtpServer: string;
  smtpPort: number;
  useSsl: boolean;
  smtpUser: string;
  smtpPass: string;
  senderEmail: string;
  senderName: string;
}

/**
 * Load email configuration from config.json and decrypt SMTP password.
 */
function loadEmailConfig(): EmailConfig {
  const configPath = join(process.cwd(), "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  const emailCfg = config.email;

  let smtpPass = "";
  const passRef = emailCfg.smtpPass;

  if (passRef.startsWith("ENV:")) {
    // Read from .env
    const envKey = passRef.replace("ENV:", "");
    const envPath = join(process.cwd(), ".env");
    const envContent = readFileSync(envPath, "utf-8");
    const match = envContent.match(new RegExp(`${envKey}=(?:FERNET:)?["']?([^"'\\r\\n]+)["']?`));
    const rawValue = match ? match[1] : "";

    if (rawValue.startsWith("gAAAAA")) {
      const keyPath = join(process.cwd(), "scripts", ".encryption_key");
      try {
        smtpPass = execSync(
          `python -c "import sys; from cryptography.fernet import Fernet; key = open(r'${keyPath}','rb').read(); f = Fernet(key); print(f.decrypt(b'${rawValue}').decode(), end='')"`,
          { encoding: "utf-8", timeout: 10000 }
        ).trim();
      } catch {
        console.error("[Email] Failed to decrypt SMTP password");
      }
    } else {
      smtpPass = rawValue;
    }
  } else {
    smtpPass = passRef;
  }

  return {
    smtpServer: emailCfg.smtpServer,
    smtpPort: emailCfg.smtpPort,
    useSsl: emailCfg.useSsl,
    smtpUser: emailCfg.smtpUser,
    smtpPass,
    senderEmail: emailCfg.senderEmail,
    senderName: emailCfg.senderName,
  };
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    const cfg = loadEmailConfig();
    transporter = nodemailer.createTransport({
      host: cfg.smtpServer,
      port: cfg.smtpPort,
      secure: cfg.useSsl && cfg.smtpPort === 465,
      auth: {
        user: cfg.smtpUser,
        pass: cfg.smtpPass,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
    console.log(`[Email] SMTP transporter created → ${cfg.smtpServer}:${cfg.smtpPort}`);
  }
  return transporter;
}

/**
 * Send an OTP email for signup verification or password reset.
 */
export async function sendOtpEmail(
  to: string,
  otp: string,
  purpose: "signup" | "forgot-password",
  language: "vi" | "en" = "vi"
): Promise<boolean> {
  const cfg = loadEmailConfig();
  const transport = getTransporter();

  const subjects = {
    signup: {
      vi: `[Cổng Đặt Hàng] Mã xác thực đăng ký: ${otp}`,
      en: `[Ordering Portal] Sign-up verification code: ${otp}`,
    },
    "forgot-password": {
      vi: `[Cổng Đặt Hàng] Mã xác thực đặt lại mật khẩu: ${otp}`,
      en: `[Ordering Portal] Password reset code: ${otp}`,
    },
  };

  const bodies = {
    signup: {
      vi: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #2BBCB3, #1E9A92); color: #fff; font-size: 28px; line-height: 56px;">📧</div>
          </div>
          <h2 style="text-align: center; color: #0F172A; margin-bottom: 8px;">Xác thực Email</h2>
          <p style="text-align: center; color: #64748B; font-size: 14px; margin-bottom: 24px;">
            Vui lòng nhập mã xác thực bên dưới để hoàn tất đăng ký tài khoản.
          </p>
          <div style="text-align: center; padding: 20px; background: #F1F5F9; border-radius: 12px; margin-bottom: 24px;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #2BBCB3;">${otp}</span>
          </div>
          <p style="text-align: center; color: #94A3B8; font-size: 13px;">
            Mã xác thực có hiệu lực trong <strong>10 phút</strong>.<br/>
            Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email.
          </p>
        </div>
      `,
      en: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #2BBCB3, #1E9A92); color: #fff; font-size: 28px; line-height: 56px;">📧</div>
          </div>
          <h2 style="text-align: center; color: #0F172A; margin-bottom: 8px;">Email Verification</h2>
          <p style="text-align: center; color: #64748B; font-size: 14px; margin-bottom: 24px;">
            Please enter the verification code below to complete your account registration.
          </p>
          <div style="text-align: center; padding: 20px; background: #F1F5F9; border-radius: 12px; margin-bottom: 24px;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #2BBCB3;">${otp}</span>
          </div>
          <p style="text-align: center; color: #94A3B8; font-size: 13px;">
            This code is valid for <strong>10 minutes</strong>.<br/>
            If you did not request this code, please ignore this email.
          </p>
        </div>
      `,
    },
    "forgot-password": {
      vi: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #FF6B35, #E55520); color: #fff; font-size: 28px; line-height: 56px;">🔑</div>
          </div>
          <h2 style="text-align: center; color: #0F172A; margin-bottom: 8px;">Đặt lại mật khẩu</h2>
          <p style="text-align: center; color: #64748B; font-size: 14px; margin-bottom: 24px;">
            Vui lòng nhập mã xác thực bên dưới để đặt lại mật khẩu.
          </p>
          <div style="text-align: center; padding: 20px; background: #F1F5F9; border-radius: 12px; margin-bottom: 24px;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #FF6B35;">${otp}</span>
          </div>
          <p style="text-align: center; color: #94A3B8; font-size: 13px;">
            Mã xác thực có hiệu lực trong <strong>10 phút</strong>.<br/>
            Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.
          </p>
        </div>
      `,
      en: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #FF6B35, #E55520); color: #fff; font-size: 28px; line-height: 56px;">🔑</div>
          </div>
          <h2 style="text-align: center; color: #0F172A; margin-bottom: 8px;">Reset Password</h2>
          <p style="text-align: center; color: #64748B; font-size: 14px; margin-bottom: 24px;">
            Please enter the verification code below to reset your password.
          </p>
          <div style="text-align: center; padding: 20px; background: #F1F5F9; border-radius: 12px; margin-bottom: 24px;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #FF6B35;">${otp}</span>
          </div>
          <p style="text-align: center; color: #94A3B8; font-size: 13px;">
            This code is valid for <strong>10 minutes</strong>.<br/>
            If you did not request a password reset, please ignore this email.
          </p>
        </div>
      `,
    },
  };

  try {
    await transport.sendMail({
      from: `"${cfg.senderName}" <${cfg.senderEmail}>`,
      to,
      subject: subjects[purpose][language],
      html: bodies[purpose][language],
    });
    console.log(`[Email] OTP sent to ${to} (${purpose})`);
    return true;
  } catch (error) {
    console.error("[Email] Failed to send OTP:", error);
    return false;
  }
}

/**
 * Send an approval notification email to a customer.
 */
export async function sendApprovalEmail(
  to: string,
  customerName: string,
  language: "vi" | "en" = "vi"
): Promise<boolean> {
  const cfg = loadEmailConfig();
  const transport = getTransporter();

  const subjects = {
    vi: `[Cổng Đặt Hàng] Tài khoản đã được duyệt`,
    en: `[Ordering Portal] Your account has been approved`,
  };

  const bodies = {
    vi: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="display: inline-block; width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #10B981, #059669); color: #fff; font-size: 28px; line-height: 56px;">✓</div>
        </div>
        <h2 style="text-align: center; color: #0F172A; margin-bottom: 8px;">Tài khoản đã được duyệt</h2>
        <p style="text-align: center; color: #64748B; font-size: 14px; margin-bottom: 24px;">
          Xin chào <strong>${customerName}</strong>,<br/>
          Tài khoản của bạn đã được quản trị viên phê duyệt. Bạn có thể đăng nhập và bắt đầu đặt hàng ngay bây giờ.
        </p>
        <div style="text-align: center;">
          <a href="#" style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #2BBCB3, #1E9A92); color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Đăng nhập ngay</a>
        </div>
      </div>
    `,
    en: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="display: inline-block; width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #10B981, #059669); color: #fff; font-size: 28px; line-height: 56px;">✓</div>
        </div>
        <h2 style="text-align: center; color: #0F172A; margin-bottom: 8px;">Account Approved</h2>
        <p style="text-align: center; color: #64748B; font-size: 14px; margin-bottom: 24px;">
          Hello <strong>${customerName}</strong>,<br/>
          Your account has been approved by the administrator. You can now login and start placing orders.
        </p>
        <div style="text-align: center;">
          <a href="#" style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #2BBCB3, #1E9A92); color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Login Now</a>
        </div>
      </div>
    `,
  };

  try {
    await transport.sendMail({
      from: `"${cfg.senderName}" <${cfg.senderEmail}>`,
      to,
      subject: subjects[language],
      html: bodies[language],
    });
    console.log(`[Email] Approval email sent to ${to}`);
    return true;
  } catch (error) {
    console.error("[Email] Failed to send approval email:", error);
    return false;
  }
}

/**
 * Send a rejection notification email to a customer.
 */
export async function sendRejectionEmail(
  to: string,
  customerName: string,
  reason: string,
  language: "vi" | "en" = "vi"
): Promise<boolean> {
  const cfg = loadEmailConfig();
  const transport = getTransporter();

  const subjects = {
    vi: `[Cổng Đặt Hàng] Đăng ký tài khoản không được duyệt`,
    en: `[Ordering Portal] Account registration not approved`,
  };

  const bodies = {
    vi: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="display: inline-block; width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #EF4444, #DC2626); color: #fff; font-size: 28px; line-height: 56px;">✕</div>
        </div>
        <h2 style="text-align: center; color: #0F172A; margin-bottom: 8px;">Đăng ký không được duyệt</h2>
        <p style="text-align: center; color: #64748B; font-size: 14px; margin-bottom: 16px;">
          Xin chào <strong>${customerName}</strong>,<br/>
          Rất tiếc, đăng ký tài khoản của bạn không được quản trị viên phê duyệt.
        </p>
        <div style="padding: 16px; background: #FEF2F2; border-radius: 8px; margin-bottom: 24px;">
          <p style="color: #991B1B; font-size: 14px; margin: 0;"><strong>Lý do:</strong> ${reason}</p>
        </div>
        <p style="text-align: center; color: #94A3B8; font-size: 13px;">
          Nếu bạn có thắc mắc, vui lòng liên hệ bộ phận hỗ trợ.
        </p>
      </div>
    `,
    en: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="display: inline-block; width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #EF4444, #DC2626); color: #fff; font-size: 28px; line-height: 56px;">✕</div>
        </div>
        <h2 style="text-align: center; color: #0F172A; margin-bottom: 8px;">Registration Not Approved</h2>
        <p style="text-align: center; color: #64748B; font-size: 14px; margin-bottom: 16px;">
          Hello <strong>${customerName}</strong>,<br/>
          Unfortunately, your account registration was not approved by the administrator.
        </p>
        <div style="padding: 16px; background: #FEF2F2; border-radius: 8px; margin-bottom: 24px;">
          <p style="color: #991B1B; font-size: 14px; margin: 0;"><strong>Reason:</strong> ${reason}</p>
        </div>
        <p style="text-align: center; color: #94A3B8; font-size: 13px;">
          If you have any questions, please contact our support team.
        </p>
      </div>
    `,
  };

  try {
    await transport.sendMail({
      from: `"${cfg.senderName}" <${cfg.senderEmail}>`,
      to,
      subject: subjects[language],
      html: bodies[language],
    });
    console.log(`[Email] Rejection email sent to ${to}`);
    return true;
  } catch (error) {
    console.error("[Email] Failed to send rejection email:", error);
    return false;
  }
}

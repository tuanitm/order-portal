import { useTranslations } from "next-intl";

export default function Footer() {
  const t = useTranslations();

  return (
    <footer className="footer" id="main-footer">
      <div className="footer__inner">
        <span>{t("footer.copyright")}</span>
        <div style={{ display: "flex", gap: "1.5rem" }}>
          <a href="#" style={{ transition: "color 0.2s" }}>{t("footer.contact")}</a>
          <a href="#" style={{ transition: "color 0.2s" }}>{t("footer.support")}</a>
        </div>
      </div>
    </footer>
  );
}

import { useTranslation } from "react-i18next";
import { Prose } from "../../components/ui/Prose";
import { AboutVersion } from "../../features/settings/AboutVersion";

const REPOSITORIES = [
  ["ALDEA-DAO/aldea-world", "https://github.com/ALDEA-DAO/aldea-world"],
  ["AdaSouls/protocol", "https://github.com/AdaSouls/protocol"],
  ["AdaSouls/alma", "https://github.com/AdaSouls/alma"],
  ["AdaSouls/fork-kit", "https://github.com/AdaSouls/fork-kit"],
] as const;

/**
 * `#/acerca`: what ALDEA World is, who holds each power over it today, which roles are still held as temporary
 * trust, and the credits. The same facts as the repository's GOVERNANCE.md, said for whoever plays.
 */
export function About() {
  const { t } = useTranslation();
  const rows = t("about.powers.rows", { returnObjects: true }) as { power: string; holder: string }[];
  const list = (key: string) => (t(key, { returnObjects: true }) as string[]).map((item) => <li key={item}>{item}</li>);
  return (
    <Prose
      title={t("screens.about")}
      also={[
        { to: "/terminos", key: "nav.terms" },
        { to: "/privacidad", key: "nav.privacy" },
      ]}
    >
      <p>{t("about.lead")}</p>

      <h2>{t("about.powers.title")}</h2>
      <p>{t("about.powers.intro")}</p>
      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="py-2 pr-4 font-medium">
              {t("about.powers.power")}
            </th>
            <th scope="col" className="py-2 font-medium">
              {t("about.powers.holder")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.power} className="border-b border-border align-top">
              <th scope="row" className="py-2 pr-4 text-left font-medium">
                {row.power}
              </th>
              <td className="py-2">{row.holder}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>{t("about.trust.title")}</h2>
      <p>{t("about.trust.intro")}</p>
      <ul>{list("about.trust.items")}</ul>

      <h2>{t("about.signers.title")}</h2>
      <p>{t("about.signers.text")}</p>

      <h2>{t("about.code.title")}</h2>
      <p>{t("about.code.text")}</p>
      <ul aria-label={t("about.code.repos")}>
        {REPOSITORIES.map(([name, url]) => (
          <li key={name}>
            <a className="underline" href={url} target="_blank" rel="noreferrer">
              {name}
            </a>
          </li>
        ))}
      </ul>

      <h2>{t("about.credits.title")}</h2>
      <ul>{list("about.credits.items")}</ul>

      <AboutVersion />
    </Prose>
  );
}

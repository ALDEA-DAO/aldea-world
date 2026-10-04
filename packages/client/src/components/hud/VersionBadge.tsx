import { BadgeCheck, FlaskConical, GitFork, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useVersion } from "../../features/settings/version";

const icons = { official: BadgeCheck, candidate: FlaskConical, fork: GitFork } as const;

/**
 * The top bar's word on what this client is: the official version, a candidate, a fork's client, or none of those.
 * An unofficial version is a warning with the way to the official one; a dev server or an unreadable chain shows
 * nothing rather than a guess. It leads to "About this version" in the settings.
 */
export function VersionBadge() {
  const { t } = useTranslation();
  const version = useVersion();
  if (!version || version.state === "development" || version.state === "unknown") return null;

  if (version.state === "unofficial") {
    return (
      <span data-testid="version-badge" className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-warning px-2 text-sm font-medium text-on-primary">
        <TriangleAlert aria-hidden className="size-4 shrink-0" />
        <Link to="/ajustes" className="whitespace-nowrap">
          {t("version.state.unofficial")}
        </Link>
        {version.officialUrl && (
          <a href={version.officialUrl} className="whitespace-nowrap underline underline-offset-4">
            {t("version.goToOfficial")}
          </a>
        )}
      </span>
    );
  }

  const Icon = icons[version.state];
  return (
    <Link
      to="/ajustes"
      data-testid="version-badge"
      title={t(`version.state.${version.state}`)}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm whitespace-nowrap hover:bg-black/20"
    >
      <Icon aria-hidden className="size-4" />
      {/* On narrow screens the icon stands for the label, which stays for screen readers */}
      <span className="sr-only md:not-sr-only">{t(`version.state.${version.state}`)}</span>
    </Link>
  );
}

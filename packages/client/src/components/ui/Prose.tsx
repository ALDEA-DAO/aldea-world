import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

/** A reading page: one column of up to 65 characters per line, a title, and the way back to the village and to the other reading pages. */
export function Prose({ title, children, also = [] }: { title: ReactNode; children: ReactNode; also?: { to: string; key: string }[] }) {
  const { t } = useTranslation();
  return (
    <article className="mx-auto w-full max-w-[65ch] px-4 py-12 leading-relaxed [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-2xl [&_li]:mt-1 [&_p]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
      <h1 className="text-3xl">{title}</h1>
      {children}
      <footer className="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4 text-sm">
        <Link to="/" className="underline underline-offset-4">
          {t("common.backHome")}
        </Link>
        {also.map((link) => (
          <Link key={link.to} to={link.to} className="underline underline-offset-4">
            {t(link.key)}
          </Link>
        ))}
      </footer>
    </article>
  );
}

/** A legal text as its locale file holds it: sections, each with a title and its paragraphs. */
export function Sections({ of }: { of: string }) {
  const { t } = useTranslation();
  const sections = t(of, { returnObjects: true }) as { title: string; body: string[] }[];
  return (
    <>
      {sections.map((section) => (
        <section key={section.title}>
          <h2>{section.title}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
    </>
  );
}

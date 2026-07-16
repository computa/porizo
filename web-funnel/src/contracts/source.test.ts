import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function filesBelow(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesBelow(child) : [child];
  });
}

describe("source contracts", () => {
  it("never hardcodes the illustrative offer price", () => {
    const source = filesBelow(join(process.cwd(), "src"))
      .filter((path) => /\.(ts|tsx|css)$/.test(path) && !path.includes(".test."))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).not.toContain("19.99");
  });

  it("does not attempt audio autoplay", () => {
    const source = filesBelow(join(process.cwd(), "src"))
      .filter((path) => /\.(ts|tsx)$/.test(path) && !path.includes(".test."))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/autoPlay|autoplay/);
  });

  it("uses the live site chrome and locks the centered shell", () => {
    const main = readFileSync(join(process.cwd(), "src/main.tsx"), "utf8");
    const chrome = readFileSync(join(process.cwd(), "src/components/SiteChrome.tsx"), "utf8");
    const base = readFileSync(join(process.cwd(), "design/base.css"), "utf8");

    expect(main).toContain('import "../../public/styles/main.css"');
    expect(chrome).toContain('className="nav nav--static"');
    expect(chrome).toContain("Sign in");
    expect(chrome).not.toContain("Get the app");
    expect(base).toMatch(/\.shell\s*\{[^}]*width:\s*100%;[^}]*margin-inline:\s*auto;/s);
  });

  it("routes homepage entry points into the same-tab funnel", () => {
    const homepage = readFileSync(join(process.cwd(), "../public/index.html"), "utf8");

    expect(homepage).toContain('href="/create" class="nav__cta"');
    expect(homepage).toContain('href="/create" class="btn btn--hero"');
    expect(homepage).toContain('href="/create?occasion=Birthday"');
    expect(homepage).toContain('href="/create?occasion=Anniversary"');
    expect(homepage).toContain('href="/create?occasion=Wedding"');
    expect(homepage).toContain('href="/create?occasion=Custom"');
    expect(homepage).not.toContain('href="/create?occasion=Father%27s%20Day"');
  });

  it("defines every CSS custom property consumed by the funnel", () => {
    const styles = [
      readFileSync(join(process.cwd(), "../public/styles/main.css"), "utf8"),
      readFileSync(join(process.cwd(), "design/tokens.css"), "utf8"),
      readFileSync(join(process.cwd(), "design/base.css"), "utf8"),
      readFileSync(join(process.cwd(), "src/styles.css"), "utf8"),
    ].join("\n");
    const defined = new Set([...styles.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
    const consumed = new Set([...styles.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]));

    expect([...consumed].filter((token) => !defined.has(token))).toEqual([]);
  });
});

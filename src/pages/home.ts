/**
 * The home page: hero + feature cards, or the user's home.html fragment inside the layout.
 */

import { html, type SafeHtml } from "../shared/html";
import { layout } from "./layout";
import { image } from "./parts";
import type { FeatureConfig, HeroAction, Library, Site, Urls } from "../types";

const heroAction = (action: HeroAction, index: number, urls: Urls): SafeHtml => {
  const theme = action.theme ?? (index === 0 ? "brand" : "alt");
  return html`<a class="hero-action is-${theme}" href="${urls.link(action.link)}">${action.text}</a>`;
};

const featureCard = (feature: FeatureConfig, urls: Urls): SafeHtml => {
  const icon = feature.icon
    ? html`<div class="feature-icon" aria-hidden="true">${typeof feature.icon === "string" ? feature.icon : image(feature.icon, urls, "feature-image", "")}</div>`
    : "";
  const body = html`${icon}
    <h2 class="feature-title">${feature.title}</h2>
    ${feature.details ? html`<p class="feature-details">${feature.details}</p>` : ""}
    ${feature.link && feature.linkText ? html`<span class="feature-link">${feature.linkText} <span aria-hidden="true">→</span></span>` : ""}`;
  return html`<li class="feature">${
    feature.link ? html`<a class="feature-card" href="${urls.link(feature.link)}">${body}</a>` : html`<div class="feature-card">${body}</div>`
  }</li>`;
};

const homeContent = (site: Site): SafeHtml => {
  const { urls } = site;
  const { hero, features } = site.home || { hero: {}, features: [] };
  const name = hero.name?.trim() || site.title;
  const tagline = hero.tagline ?? site.description;
  const actions = hero.actions ?? [{ text: "Browse documents", link: urls.search() }];
  const heroImage = hero.image; // already normalised by the config loader

  return html`<div class="home">
    <section class="hero${heroImage ? " has-image" : ""}">
      <div class="hero-main">
        <h1 class="hero-heading"><span class="hero-name">${name}</span>${hero.text ? html` <span class="hero-text">${hero.text}</span>` : ""}</h1>
        ${tagline ? html`<p class="hero-tagline">${tagline}</p>` : ""}
        ${actions.length ? html`<div class="hero-actions">${actions.map((action, i) => heroAction(action, i, urls))}</div>` : ""}
      </div>
      ${heroImage ? html`<div class="hero-media"><div class="hero-glow" aria-hidden="true"></div>${image(heroImage, urls, "hero-image")}</div>` : ""}
    </section>
    ${
      features.length
        ? html`<section class="features" aria-label="Highlights"><ul class="feature-grid" role="list">${features.map((feature) => featureCard(feature, urls))}</ul></section>`
        : ""
    }
  </div>`;
};

/** The landing page at the site root. `custom` is a home.html fragment that replaces the hero and cards. */
export const homePage = (site: Site, library: Library, custom?: SafeHtml): string => {
  return layout({ site, library, title: site.title, content: custom ?? homeContent(site), page: "home" });
};

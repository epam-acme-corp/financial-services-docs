import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://epam-acme-corp.github.io",
  base: "/financial-services-docs",
  integrations: [
    starlight({
      title: "Acme Financial Services",
      components: {
        ThemeSelect: './src/components/ThemeSelectWithOPCO.astro',
      },
      sidebar: [
        {
          label: "Overview",
          items: [
            { label: "Business Overview", slug: "business/overview" },
          ],
        },
        {
          label: "Architecture",
          items: [
            { label: "Architecture Overview", slug: "architecture/overview" },
            {
              label: "ADRs",
              items: [
                {
                  label: "ADR-001 Event-Driven Payments",
                  slug: "architecture/adr/adr-001-event-driven-payments",
                },
                {
                  label: "ADR-002 ML Risk Platform",
                  slug: "architecture/adr/adr-002-ml-risk-platform",
                },
                {
                  label: "ADR-003 Data Mesh Domains",
                  slug: "architecture/adr/adr-003-data-mesh-domains",
                },
              ],
            },
          ],
        },
        {
          label: "Technical",
          items: [
            { label: "System Landscape", slug: "technical/system-landscape" },
            { label: "Core Banking", slug: "technical/core-banking" },
            {
              label: "Payments Gateway",
              slug: "technical/payments-gateway",
            },
            {
              label: "Regulatory Reporting",
              slug: "technical/regulatory-reporting",
            },
            { label: "Risk Engine", slug: "technical/risk-engine" },
            {
              label: "Wealth Management",
              slug: "technical/wealth-management",
            },
          ],
        },
        {
          label: "API",
          items: [
            { label: "API Overview", slug: "api/overview" },
            { label: "Core Banking API", slug: "api/core-banking-api" },
            { label: "Event Schemas", slug: "api/event-schemas" },
          ],
        },
        {
          label: "Data",
          items: [
            { label: "Data Architecture", slug: "data/architecture" },
          ],
        },
        {
          label: "Security",
          items: [
            {
              label: "Compliance Framework",
              slug: "security/compliance-framework",
            },
          ],
        },
      ],
    }),
  ],
});

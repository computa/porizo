# Email Channel

Email assets are split across three historical folders:

- Runtime cold-email templates and state: [`../../email/`](../../email/)
- One-off lifecycle/campaign template packs: [`../../email-templates/`](../../email-templates/)
- Older GMass/nurture sequence assets and sent logs: [`../../emails/`](../../emails/)

Do not rename `marketing/email` without updating production/admin paths. The backend cold-email job and admin preview route read from that folder.

Current GTM stance: broad cold email is paused as a growth engine. Use email only for specific, permissioned, occasion-tied cohorts or for lifecycle recovery where the user already knows Porizo.


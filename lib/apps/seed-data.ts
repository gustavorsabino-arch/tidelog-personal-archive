// Initial import from App audit.xlsx: rows where Use = Current.
export const APP_SEED: { appName: string; description: string | null; paymentTerm: string | null; paymentMethod: string | null; amount: string | null; classTeam: string | null; accountOwner: string | null }[] = [
  {
    "appName": "Adobe - Design",
    "description": "Design tools",
    "paymentTerm": "annual, billed monthly",
    "paymentMethod": "3228",
    "amount": "69.99/mo + tax",
    "classTeam": "Product",
    "accountOwner": "sysops"
  },
  {
    "appName": "Adobe - Legal",
    "description": "Acrobat",
    "paymentTerm": "annual",
    "paymentMethod": "3228",
    "amount": "239.88/yr + tax",
    "classTeam": "Legal",
    "accountOwner": null
  },
  {
    "appName": "Aer (StarCompliance)",
    "description": "ORCA internal trading platform",
    "paymentTerm": null,
    "paymentMethod": "invoice",
    "amount": null,
    "classTeam": "Legal",
    "accountOwner": "no owner - individual logins but legal has full access to admin accont"
  },
  {
    "appName": "Altitude.xyz",
    "description": "Banking",
    "paymentTerm": "free",
    "paymentMethod": null,
    "amount": null,
    "classTeam": "Finance",
    "accountOwner": "finance"
  },
  {
    "appName": "AWS (3)",
    "description": "Cloud Data",
    "paymentTerm": null,
    "paymentMethod": "via Kast",
    "amount": null,
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "Birdeye",
    "description": "API",
    "paymentTerm": "monthly",
    "paymentMethod": "444",
    "amount": "ranges $700-4k",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "Blacksmith",
    "description": "Github integration",
    "paymentTerm": "monthly",
    "paymentMethod": "444",
    "amount": "ranges $100-$275",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "ChatGPT",
    "description": "Productivity tool",
    "paymentTerm": "monthly",
    "paymentMethod": "2073",
    "amount": "$25/seat",
    "classTeam": "Operations",
    "accountOwner": "sysops"
  },
  {
    "appName": "Claude",
    "description": "Productivity tool",
    "paymentTerm": "monthly",
    "paymentMethod": "2073",
    "amount": "$25/seat regular, $125/seat Pro",
    "classTeam": "Operations",
    "accountOwner": "sysops"
  },
  {
    "appName": "Checkr",
    "description": "Background checker system",
    "paymentTerm": "pay per background check",
    "paymentMethod": "2073",
    "amount": "varies US vs. international",
    "classTeam": "Operations",
    "accountOwner": "sysops"
  },
  {
    "appName": "Cloudflare",
    "description": "Website security",
    "paymentTerm": null,
    "paymentMethod": "444",
    "amount": null,
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "Coingecko",
    "description": null,
    "paymentTerm": "annual",
    "paymentMethod": "444",
    "amount": "$4790 + any overages",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "Contentful",
    "description": "Content management",
    "paymentTerm": "free",
    "paymentMethod": null,
    "amount": null,
    "classTeam": "Marketing",
    "accountOwner": "sysops"
  },
  {
    "appName": "Datadog",
    "description": "Monitoring and security",
    "paymentTerm": null,
    "paymentMethod": "444",
    "amount": "$2285.95 + any overages (typically 3800-4k total/mo)",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "DocuSign",
    "description": "Document electronic signature",
    "paymentTerm": "annual",
    "paymentMethod": "7234",
    "amount": "$600/yr",
    "classTeam": "Legal",
    "accountOwner": "sysops"
  },
  {
    "appName": "Discord",
    "description": null,
    "paymentTerm": "for boosts only (if needed)",
    "paymentMethod": null,
    "amount": null,
    "classTeam": "Operations",
    "accountOwner": "personal admin"
  },
  {
    "appName": "Doppel",
    "description": "AI-based digital risk protection company",
    "paymentTerm": null,
    "paymentMethod": "invoice",
    "amount": null,
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "Dune",
    "description": "Analytics",
    "paymentTerm": "free",
    "paymentMethod": null,
    "amount": null,
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "Figma",
    "description": "Designing, prototyping and collab on UI",
    "paymentTerm": "annual",
    "paymentMethod": "invoice",
    "amount": "depending on collab, dev and full seats. quarterly billing for updated seats",
    "classTeam": "Operations",
    "accountOwner": "personal admin"
  },
  {
    "appName": "Fireblocks",
    "description": "Digital assets wallets",
    "paymentTerm": "annual",
    "paymentMethod": "invoice",
    "amount": "50000",
    "classTeam": "Finance",
    "accountOwner": "personal admin"
  },
  {
    "appName": "Getro",
    "description": "Talent acqusition job board",
    "paymentTerm": null,
    "paymentMethod": "invoice",
    "amount": null,
    "classTeam": "Operations",
    "accountOwner": "personal admin"
  },
  {
    "appName": "GitHub",
    "description": "Code collaboration tool",
    "paymentTerm": "monthly",
    "paymentMethod": "444",
    "amount": "$4/seat",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "GoDaddy",
    "description": "zagreus domain",
    "paymentTerm": "annual",
    "paymentMethod": "444",
    "amount": "$16.99 marketing, $22.99/yr domain",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "Google Workspace",
    "description": null,
    "paymentTerm": null,
    "paymentMethod": "2073",
    "amount": null,
    "classTeam": "Operations",
    "accountOwner": "personal admin"
  },
  {
    "appName": "Greptile",
    "description": "AI code reviewer",
    "paymentTerm": "monthly",
    "paymentMethod": "444",
    "amount": "$30/mo/seat",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "Helius",
    "description": "RPC",
    "paymentTerm": "annual",
    "paymentMethod": "invoice",
    "amount": "$23,040/yr",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "Open AI (ChatGPT)",
    "description": "Chatgpt API",
    "paymentTerm": "as needed",
    "paymentMethod": "2073",
    "amount": "when balance reaches $20, reloads $100, up to monthly limit of $150",
    "classTeam": "Operations",
    "accountOwner": "sysops"
  },
  {
    "appName": "ifttt",
    "description": "Twitter/Slack automation",
    "paymentTerm": "annual",
    "paymentMethod": "2073",
    "amount": "35.88/yr",
    "classTeam": "Operations",
    "accountOwner": "sysops"
  },
  {
    "appName": "Immunefi",
    "description": "Bug bounties",
    "paymentTerm": "as needed",
    "paymentMethod": "invoice",
    "amount": "pay 10% of bounty amount when paid",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "iPostal",
    "description": "Digital mailbox (2248 Broadway)",
    "paymentTerm": "monthly",
    "paymentMethod": "3228",
    "amount": "$14.99/mo + any overages",
    "classTeam": "Operations",
    "accountOwner": "sysops"
  },
  {
    "appName": "Ironforge",
    "description": "RPC load balancer",
    "paymentTerm": "monthly",
    "paymentMethod": "444",
    "amount": "$749/mo base + any overages",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "Linear",
    "description": "Project management",
    "paymentTerm": "annual (SEE NOTES)",
    "paymentMethod": "2073",
    "amount": null,
    "classTeam": "Operations",
    "accountOwner": "sysops"
  },
  {
    "appName": "Loom",
    "description": "Video screen recorder",
    "paymentTerm": null,
    "paymentMethod": null,
    "amount": null,
    "classTeam": null,
    "accountOwner": "personal admin"
  },
  {
    "appName": "lu.ma",
    "description": "Event hosting",
    "paymentTerm": null,
    "paymentMethod": null,
    "amount": null,
    "classTeam": "Individual",
    "accountOwner": "personal admin"
  },
  {
    "appName": "LinkedIn",
    "description": null,
    "paymentTerm": "free or as needed per account",
    "paymentMethod": null,
    "amount": null,
    "classTeam": "Individual",
    "accountOwner": "personal admin"
  },
  {
    "appName": "MetaCRM",
    "description": "CRM",
    "paymentTerm": "quarterly",
    "paymentMethod": "invoice",
    "amount": null,
    "classTeam": null,
    "accountOwner": "personal admin"
  },
  {
    "appName": "Mintlify",
    "description": "AI documentation platform",
    "paymentTerm": "annual",
    "paymentMethod": "2073",
    "amount": null,
    "classTeam": "Operations",
    "accountOwner": "sysops"
  },
  {
    "appName": "Mixpanel",
    "description": "Product analytics",
    "paymentTerm": "annual",
    "paymentMethod": "5145",
    "amount": "depending on usage",
    "classTeam": "Product",
    "accountOwner": "personal admin"
  },
  {
    "appName": "Namecheap",
    "description": "orca domains",
    "paymentTerm": "annual",
    "paymentMethod": "444",
    "amount": null,
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "Node40",
    "description": "Crypto Subledger - Accounting",
    "paymentTerm": "annual",
    "paymentMethod": "invoice",
    "amount": "$2000/month",
    "classTeam": "Finance",
    "accountOwner": "personal admin"
  },
  {
    "appName": "Notion",
    "description": "Document hub",
    "paymentTerm": null,
    "paymentMethod": "2073",
    "amount": null,
    "classTeam": "Operations",
    "accountOwner": "personal admin"
  },
  {
    "appName": "Novu",
    "description": "Workflow automation",
    "paymentTerm": "free",
    "paymentMethod": null,
    "amount": null,
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "npm",
    "description": "Package mananger for SDKs",
    "paymentTerm": "free",
    "paymentMethod": null,
    "amount": null,
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "PagerDuty",
    "description": "On call incident response",
    "paymentTerm": "monthly",
    "paymentMethod": "444",
    "amount": "$25/seat/mo",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "Pave",
    "description": "Salary benchmarks",
    "paymentTerm": "free",
    "paymentMethod": null,
    "amount": null,
    "classTeam": null,
    "accountOwner": null
  },
  {
    "appName": "Peoplekeep",
    "description": "ICHRA health benefits",
    "paymentTerm": "monthly",
    "paymentMethod": "3228",
    "amount": "$50 flat + $25/seat",
    "classTeam": "Operations",
    "accountOwner": "personal admin"
  },
  {
    "appName": "Privy",
    "description": "Authentication and wallet infrastructure for devs",
    "paymentTerm": "free",
    "paymentMethod": null,
    "amount": null,
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "Provenance",
    "description": "KYC/KYB third party",
    "paymentTerm": "as needed",
    "paymentMethod": "invoice",
    "amount": null,
    "classTeam": "Legal",
    "accountOwner": "personal admin"
  },
  {
    "appName": "Quickbooks",
    "description": "Accounting",
    "paymentTerm": "monthly",
    "paymentMethod": "9472",
    "amount": "Opco - $99.86/mo, all others - $777.36",
    "classTeam": "Finance",
    "accountOwner": "sysops"
  },
  {
    "appName": "Screen.Studio",
    "description": null,
    "paymentTerm": "annual (March 5)",
    "paymentMethod": null,
    "amount": null,
    "classTeam": "Marketing",
    "accountOwner": "accounting"
  },
  {
    "appName": "Sentry",
    "description": "Monitoring",
    "paymentTerm": "monthly",
    "paymentMethod": "444",
    "amount": "pay as you go ~$300/mo",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "Slack",
    "description": null,
    "paymentTerm": "monthly",
    "paymentMethod": "2073",
    "amount": "$18/seat/mo",
    "classTeam": "Operations",
    "accountOwner": "personal admin"
  },
  {
    "appName": "Tailscale",
    "description": "to connect VPC envs",
    "paymentTerm": "monthly",
    "paymentMethod": "444",
    "amount": "$8/seat/mo",
    "classTeam": null,
    "accountOwner": "sysops"
  },
  {
    "appName": "Tally",
    "description": "Form builder",
    "paymentTerm": "monthly",
    "paymentMethod": "2073",
    "amount": "$29/mo",
    "classTeam": "Operations",
    "accountOwner": "sysops"
  },
  {
    "appName": "Terraform",
    "description": "Infrastructure tool",
    "paymentTerm": "monthly",
    "paymentMethod": "3228",
    "amount": "pay as you go ~$80-$150/mo",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "TigerData/Timescale",
    "description": "Database management",
    "paymentTerm": "monthly",
    "paymentMethod": "444",
    "amount": "pay as you go ~15k/mo",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "TopLedger",
    "description": "Analytics",
    "paymentTerm": "monthly",
    "paymentMethod": "invoice",
    "amount": "$2500/mo",
    "classTeam": "Engineering",
    "accountOwner": "no owner - logins done through TopLedger team via TG"
  },
  {
    "appName": "Transluscent",
    "description": "Multi-entity finance",
    "paymentTerm": "free",
    "paymentMethod": null,
    "amount": null,
    "classTeam": "Engineering",
    "accountOwner": "personal admin"
  },
  {
    "appName": "typefully",
    "description": "marketing",
    "paymentTerm": "annual",
    "paymentMethod": "6507",
    "amount": "$468/yr",
    "classTeam": "Marketing",
    "accountOwner": "sysops (team@orca.so)"
  },
  {
    "appName": "Vercel",
    "description": "Deploy and host apps",
    "paymentTerm": "monthly",
    "paymentMethod": "444",
    "amount": "pay as you go ~$400-$700/mo for orca-so, pay as you go max $80/mo for orca-ops",
    "classTeam": "Engineering",
    "accountOwner": "sysops"
  },
  {
    "appName": "X",
    "description": "Twitter",
    "paymentTerm": "free with integration",
    "paymentMethod": null,
    "amount": null,
    "classTeam": "Operations",
    "accountOwner": "sysops"
  },
  {
    "appName": "Zapier",
    "description": "Workflow automation",
    "paymentTerm": "free",
    "paymentMethod": null,
    "amount": null,
    "classTeam": "Operations",
    "accountOwner": "sysops"
  },
  {
    "appName": "1Password",
    "description": "Password management",
    "paymentTerm": "annual",
    "paymentMethod": "2073",
    "amount": "$47.88+tax/seat/year",
    "classTeam": "Operations",
    "accountOwner": null
  }
]

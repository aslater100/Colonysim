/**
 * In-game wiki panel showing game mechanics, resources, buildings, and tips.
 * Accessible from the main HUD and provides context-aware help.
 */

interface WikiSection {
  id: string;
  title: string;
  icon: string;
  articles: WikiArticle[];
}

interface WikiArticle {
  id: string;
  title: string;
  content: string;
  tags: string[];
}

const WIKI_SECTIONS: WikiSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: '🎯',
    articles: [
      {
        id: 'basics',
        title: 'Game Basics',
        content: `<strong>Centuria</strong> is a deep simulation builder where you grow a colony from 1800 to 2100.
        Your goal is to guide settlers through eras, manage resources, research technologies, and build a thriving nation.

        <strong>Key Concepts:</strong>
        • <em>Settlers</em> are individuals with needs, skills, and desires
        • <em>Resources</em> flow through your economy (food, wood, crafts, ore, etc.)
        • <em>Jobs</em> are assigned by work priorities - prioritize what matters most
        • <em>Technology</em> unlocks new buildings and capabilities each era`,
        tags: ['basics', 'gameplay']
      },
      {
        id: 'tutorial',
        title: 'First Steps',
        content: `<strong>Step 1: Build Shelter</strong> - Place houses so settlers have somewhere to sleep.

        <strong>Step 2: Gather Food</strong> - Assign gatherers to collect berries or build a kitchen to cook grain.

        <strong>Step 3: Research Tech</strong> - Build a Town Hall and assign researchers to unlock new technologies.

        <strong>Step 4: Expand</strong> - As your colony grows, build specialized buildings for industry and commerce.

        <strong>Key Tip:</strong> Check the work priorities panel (right side) to direct settler effort where you need it most.`,
        tags: ['tutorial', 'getting-started']
      }
    ]
  },
  {
    id: 'mechanics',
    title: 'Core Mechanics',
    icon: '⚙️',
    articles: [
      {
        id: 'needs',
        title: 'Settler Needs',
        content: `Every settler has fundamental needs that affect morale and productivity:

        <strong>Basic Needs:</strong>
        • <em>Food</em> - Without meals, settlers starve. Morale drops if variety is limited.
        • <em>Sleep</em> - Needs a house with bed. Poor housing causes depression.
        • <em>Warmth</em> - In winter, settlers near hearths are happier. Cold = sickness.

        <strong>Social Needs:</strong>
        • <em>Recreation</em> - Access to bars, games, festivals. Boredom kills morale.
        • <em>Community</em> - Settlers are happier near others. Isolation is depressing.
        • <em>Meaning</em> - Many settlers want meaningful work, not just any job.

        <strong>Tip:</strong> Morale affects productivity. High morale = faster work. Low morale = strikes and emigration.`,
        tags: ['mechanics', 'settlers']
      },
      {
        id: 'economy',
        title: 'Economy & Trade',
        content: `Your economy runs on <strong>resource flow</strong>. Raw materials become processed goods:

        <strong>Resource Chains:</strong>
        • Wood → Timber (at Sawmill)
        • Clay → Brick (at Kiln)
        • Ore + Coke → Iron (at Blacksmith)
        • Grain → Meals or Ale (at Kitchen/Brewery)

        <strong>Markets & Trading:</strong>
        • Build a Market to trade with passing merchants
        • Surplus goods can be exported for profit
        • Import rare resources if production can't keep up

        <strong>Tip:</strong> Monitor stockpiles. Too much waste storage, too little causes gridlock.`,
        tags: ['mechanics', 'economy']
      },
      {
        id: 'jobs-priorities',
        title: 'Jobs & Priorities',
        content: `Settlers automatically take jobs based on <strong>work priorities</strong>.

        <strong>Priority Levels:</strong>
        • <em>0 (Disabled)</em> - No one will do this job
        • <em>1 (Low)</em> - Settlers take this only if other jobs are unavailable
        • <em>2 (Medium)</em> - Settlers prefer these jobs unless higher priority exists
        • <em>3 (High)</em> - Settlers prioritize these above all else

        <strong>Strategic Tips:</strong>
        • Harvest food at High priority during winter to prevent starvation
        • Keep construction at Medium during peacetime, High during expansion
        • Research is vital for unlocking new tech, but not always urgent
        • Idle jobs at 0 priority if you have no buildings for them`,
        tags: ['mechanics', 'priorities']
      }
    ]
  },
  {
    id: 'buildings',
    title: 'Buildings & Crafts',
    icon: '🏢',
    articles: [
      {
        id: 'shelter-buildings',
        title: 'Shelter Buildings',
        content: `<strong>House</strong> - Sleeps 3 settlers. The foundation of your colony.
        <strong>Longhouse</strong> - Sleeps 12. For communal-type settlers who thrive in groups.
        <strong>Clinic</strong> - Heals injured settlers. Medicine from Apothecary speeds healing.
        <strong>Schoolhouse</strong> - +25% research speed per building. Invest in education for long-term growth.`,
        tags: ['buildings', 'shelter']
      },
      {
        id: 'food-buildings',
        title: 'Food & Farming',
        content: `<strong>Gatherer Site</strong> - Free food from foraged berries (early game, slow production).
        <strong>Kitchen</strong> - Converts grain into meals (faster processing).
        <strong>Granary</strong> - +150 meal storage. Build multiple for large stockpiles.
        <strong>Hunt Lodge</strong> - Hunters bring game. Requires wilderness nearby.
        <strong>Farm/Garden</strong> - Free food over time. Needs Horticulture tech.
        <strong>Mill</strong> - Grain → produce (variety). Unlocked in Industrial Era.
        <strong>Canning Factory</strong> - Preserves food for long-term storage. Modern Era tech.`,
        tags: ['buildings', 'food']
      }
    ]
  },
  {
    id: 'technology',
    title: 'Research & Tech',
    icon: '📚',
    articles: [
      {
        id: 'research',
        title: 'How to Research',
        content: `<strong>Building a Research Capability:</strong>
        1. Build a Town Hall (costs 60 wood, 20 stone)
        2. Assign a settler to Researcher priority
        3. Access the Research panel to view available tech
        4. Tech progresses over time as researchers work

        <strong>Tech Trees by Era:</strong>
        • <em>Pioneer Era (1900s)</em> - Basic farming, hunting, gathering, steam power
        • <em>Industrial Era (1920s-1950s)</em> - Steel production, railways, factory systems, mass manufacturing
        • <em>Modern Era (1960s-1990s)</em> - Electronics, computers, automobiles, advanced logistics
        • <em>Information Era (2000s)</em> - Robotics, automation, digital infrastructure
        • <em>Space Age (2050s-2100)</em> - Advanced technology, off-world capabilities

        <strong>Tip:</strong> Prioritize foundational techs that unlock entire building categories.`,
        tags: ['research', 'technology']
      }
    ]
  },
  {
    id: 'tips',
    title: 'Pro Tips',
    icon: '💡',
    articles: [
      {
        id: 'early-game',
        title: 'Early Game Strategy',
        content: `<strong>First Year (Winter Critical):</strong>
        • Harvest aggressively before winter - you'll need 2x normal food stocks
        • Build at least 2 hearths for cold survival
        • Get a basic kitchen running before spring

        <strong>Build Order:</strong>
        1. Shelter (houses)
        2. Food production (kitchen, gatherer site)
        3. Town Hall + Researcher
        4. Expand housing as population grows
        5. Specialized industry once settled`,
        tags: ['tips', 'strategy']
      },
      {
        id: 'mid-game',
        title: 'Mid Game Scaling',
        content: `<strong>Growth Phase (Years 2-5):</strong>
        • Your colony should double in size each year if well-managed
        • Build schools early - education compounds over time
        • Establish trade routes to stabilize volatile resources
        • Invest in warehouses to prevent resource bottlenecks

        <strong>Avoiding Collapse:</strong>
        • Monitor morale carefully - it's your canary in the coal mine
        • Ensure food diversity (3+ food types) to keep morale high
        • Recreation (bars, festivals) is essential, not optional
        • Keep population sustainable - don't grow faster than housing/food`,
        tags: ['tips', 'strategy']
      },
      {
        id: 'late-game',
        title: 'Late Game Mastery',
        content: `<strong>Established Civilization (Years 10+):</strong>
        • Optimize supply chains - remove bottlenecks in resource flow
        • Automate via priorities - let the system handle routine work
        • Diversify economy - don't depend on a single export
        • Plan for era transitions - new eras unlock powerful tech but disrupt industries

        <strong>Victory Conditions:</strong>
        • Advance through eras by meeting specific milestones
        • Each era unlocks new buildings and challenges
        • By 2100, aim for a sustainable, thriving nation`,
        tags: ['tips', 'strategy']
      }
    ]
  }
];

export class WikiPanel {
  private container: HTMLElement;
  private visible: boolean = false;
  private currentSection: string = 'getting-started';
  private currentArticle: string = 'basics';

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'wiki-panel hidden';
    this.container.innerHTML = this.render();
    parent.appendChild(this.container);
    this.attachEventListeners();
  }

  private render(): string {
    const section = WIKI_SECTIONS.find(s => s.id === this.currentSection)!;
    const article = section.articles.find(a => a.id === this.currentArticle)!;

    return `
      <div class="wiki-header">
        <h2>📖 In-Game Wiki</h2>
        <button class="wiki-close" aria-label="Close wiki">✕</button>
      </div>

      <div class="wiki-content">
        <div class="wiki-sidebar">
          <div class="wiki-sections">
            ${WIKI_SECTIONS.map(s => `
              <button class="wiki-section-btn ${s.id === this.currentSection ? 'active' : ''}"
                      data-section="${s.id}">
                ${s.icon} ${s.title}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="wiki-main">
          <div class="wiki-articles">
            ${section.articles.map(a => `
              <button class="wiki-article-btn ${a.id === this.currentArticle ? 'active' : ''}"
                      data-article="${a.id}">
                ${a.title}
              </button>
            `).join('')}
          </div>

          <div class="wiki-article">
            <h3>${article.title}</h3>
            <div class="wiki-article-content">
              ${article.content}
            </div>
            <div class="wiki-tags">
              ${article.tags.map(tag => `<span class="wiki-tag">${tag}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private attachEventListeners(): void {
    this.container.querySelectorAll('.wiki-close').forEach(btn => {
      btn.addEventListener('click', () => this.toggle());
    });

    this.container.querySelectorAll('.wiki-section-btn').forEach(btn => {
      btn.addEventListener('click', (e: Event) => {
        this.currentSection = (e.currentTarget as HTMLElement).getAttribute('data-section')!;
        this.currentArticle = WIKI_SECTIONS.find(s => s.id === this.currentSection)!.articles[0].id;
        this.refresh();
      });
    });

    this.container.querySelectorAll('.wiki-article-btn').forEach(btn => {
      btn.addEventListener('click', (e: Event) => {
        this.currentArticle = (e.currentTarget as HTMLElement).getAttribute('data-article')!;
        this.refresh();
      });
    });
  }

  private refresh(): void {
    this.container.innerHTML = this.render();
    this.attachEventListeners();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.container.classList.toggle('hidden', !this.visible);
  }

  show(): void {
    this.visible = true;
    this.container.classList.remove('hidden');
  }

  hide(): void {
    this.visible = false;
    this.container.classList.add('hidden');
  }

  isVisible(): boolean {
    return this.visible;
  }
}

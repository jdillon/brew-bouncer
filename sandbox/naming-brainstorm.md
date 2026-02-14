# Naming Brainstorm: macOS Homebrew Management Tool

**Date**: 2026-02-07
**Context**: CLI tool that wraps `brew update && brew upgrade --greedy`, detects upgraded running apps/processes, and helps restart them. Future vision includes a macOS menu bar app for daily Homebrew management.

**Validation**: All candidates checked against Homebrew formulae -- no conflicts found as of this writing.

---

## Evaluation Criteria

| Criterion | Weight |
|-----------|--------|
| Brevity / typability as CLI command | High |
| Brewing theme connection | High |
| Evokes management/refresh/restart | Medium |
| Works as both CLI and .app name | High |
| No namespace conflicts | High |
| Memorability | Medium |

---

## Candidates

### 1. Brew Bouncer (current working name)

**Why it works**: "Bouncer" does double duty -- a bouncer manages who gets in and out (gatekeeper for upgrades), and "bouncing" is literally restarting processes. It's clever without being forced.

- **CLI**: `$ brew-bouncer upgrade` or `$ bouncer upgrade`
- **Menu bar**: "Brew Bouncer" or "Bouncer"
- **Downsides**: Two words is slightly long for a CLI command. The hyphenated form `brew-bouncer` is 13 characters. Could shorten to just `bouncer` for the CLI binary, but `bouncer` alone loses the brewing connection. Also, "bouncer" has a mildly aggressive connotation (nightclub enforcer) -- could be a feature or a bug depending on taste.
- **Verdict**: Genuinely good. The pun is tight and the metaphor holds up under scrutiny. Worth keeping on the shortlist.

### 2. Taproom

**Why it works**: A taproom is where you go to manage and serve what's on tap. Homebrew already uses "tap" for repositories, so this extends the metaphor naturally -- the taproom is where you oversee all your taps. Also evokes a place of control and oversight.

- **CLI**: `$ taproom upgrade`
- **Menu bar**: "Taproom"
- **Downsides**: 7 characters is reasonable but not ultra-short. Doesn't directly evoke restarting. Could be confused with Homebrew's `brew tap` subcommand conceptually, though that's arguably a feature (it's managing your taps).
- **Verdict**: Strong. Professional-sounding, clear brewing connection, good app name.

### 3. Barback

**Why it works**: A barback is the person behind the bar who keeps everything stocked, clean, and running smoothly -- they do the unglamorous maintenance work so the bartender (you) can focus on the actual work. That's exactly what this tool does: the maintenance layer that keeps your system fresh.

- **CLI**: `$ barback upgrade`
- **Menu bar**: "Barback"
- **Downsides**: Not everyone knows what a barback is. The term is more bar/restaurant than brewery-specific, but the connection is clear enough. 7 characters.
- **Verdict**: Excellent metaphor. The "silent maintainer" angle is perfect for a tool that handles upgrades and restarts in the background. Top pick.

### 4. Topoff

**Why it works**: "Top off" means to refill a glass -- a natural metaphor for upgrading packages to their latest versions. Also implies a quick, routine action rather than a heavy operation, which matches the tool's daily-driver intent.

- **CLI**: `$ topoff` (no subcommand needed for the simple case)
- **Menu bar**: "Topoff"
- **Downsides**: 6 characters, very typable. Doesn't strongly evoke restarting. Slightly generic -- could be a tool for anything. The one-word spelling looks slightly odd compared to "top off" (two words), but that's standard for CLI tools.
- **Verdict**: Clean and intuitive. Great as a quick CLI command. Slightly weaker as an app name.

### 5. Rebrew

**Why it works**: "Re-brew" directly communicates the action: re-running the brew process. The "re-" prefix naturally maps to upgrade (re-install), refresh, and restart. Simple, self-explanatory.

- **CLI**: `$ rebrew upgrade`
- **Menu bar**: "Rebrew"
- **Downsides**: 6 characters, good to type. Could be mistaken for a Homebrew subcommand or official tool. Doesn't stand alone well outside the Homebrew context -- if someone sees "Rebrew" with no context, it's not immediately clear what it is.
- **Verdict**: Solid utility name. Very clear about what it does. Slightly clinical.

### 6. Growler

**Why it works**: A growler is a container you take to a brewery to get filled with fresh beer -- the emphasis is on getting the freshest version. The tool "fills up" your system with fresh packages. Also, "growler" has a fun, slightly playful energy.

- **CLI**: `$ growler upgrade`
- **Menu bar**: "Growler"
- **Downsides**: 7 characters. "Growler" has some slang meanings in British English (something annoying, or a toilet) that could be awkward for international users. Doesn't evoke restart/management strongly.
- **Verdict**: Fun and memorable. The "fresh fill" metaphor works. The British English issue is minor but worth noting.

### 7. Last Call

**Why it works**: "Last call" is the final announcement at a bar before closing -- time to finish up. As a tool name, it evokes the idea of a final check: are all your packages up to date? Is everything in order before you move on? Also implies urgency and completeness.

- **CLI**: `$ lastcall upgrade` or `$ lc upgrade`
- **Menu bar**: "Last Call"
- **Downsides**: Two words (though `lastcall` as one word works fine). The "closing time" connotation is slightly at odds with a tool meant for regular daily use -- it implies finality rather than routine. 8 characters as one word.
- **Verdict**: Evocative and memorable. Better as an app name than a daily CLI command. The "are we all up to date?" angle is compelling.

### 8. Brewup

**Why it works**: Dead simple. "Brew up" means to make a batch of beer (or tea, in British English). As a CLI command, `brewup` reads like an imperative: "brew, update!" Combines the Homebrew reference with the core action.

- **CLI**: `$ brewup` (could work with no subcommand for the default action)
- **Menu bar**: "Brewup"
- **Downsides**: 6 characters, very natural to type. Risk of confusion with `brew update` or `brew upgrade` -- is `brewup` an alias or a wrapper? That ambiguity could actually help adoption (people might try it expecting it to be a shortcut) or hurt discoverability. Very close to Homebrew's own namespace.
- **Verdict**: The most intuitive name on the list. The namespace proximity to `brew` is both its greatest strength and greatest risk.

### 9. Draught

**Why it works**: Draught (draft) beer is served fresh from the tap -- the freshest, most up-to-date version. A "draught" tool keeps your system on the freshest pour. The spelling is distinctive and slightly elevated.

- **CLI**: `$ draught upgrade`
- **Menu bar**: "Draught"
- **Downsides**: 7 characters. The British spelling may cause confusion ("is it draft or draught?"). Some people won't know how to pronounce or spell it, which hurts discoverability. Could use the American spelling `draft` instead, but that's extremely generic and conflicts with many other tools/concepts (NFL draft, writing drafts, `draft` the Helm tool for Kubernetes).
- **Verdict**: Classy and distinctive if you commit to the spelling. The pronunciation/spelling barrier is real.

### 10. Tapper

**Why it works**: A tapper is someone who taps kegs -- they manage what's flowing. Extends Homebrew's "tap" metaphor. Also has a playful sound, like a casual action (tap-tap-tap on the keyboard). Short and active.

- **CLI**: `$ tapper upgrade`
- **Menu bar**: "Tapper"
- **Downsides**: 6 characters, good. Might remind people of the classic arcade game "Tapper" (1983) -- could be seen as charming or as a namespace collision depending on perspective. Close to Homebrew's `tap` concept which could cause confusion.
- **Verdict**: Catchy and fun. The arcade game reference is a slight wildcard.

### 11. Cellar

**Why it works**: Homebrew already uses "Cellar" as the directory where installed packages live (`/opt/homebrew/Cellar/`). Naming the management tool "Cellar" positions it as the caretaker of that cellar -- the one who rotates stock, checks freshness, and keeps things organized.

- **CLI**: `$ cellar upgrade`
- **Menu bar**: "Cellar"
- **Downsides**: 6 characters. Direct conflict with Homebrew's own Cellar concept and directory path. This could cause genuine confusion: "Is `cellar` a Homebrew subcommand? Is it related to `/opt/homebrew/Cellar/`?" The overlap is too tight.
- **Verdict**: Great metaphor, dangerous namespace. The Homebrew Cellar association is too strong -- people will assume it's an official Homebrew tool or get confused by the overloaded term.

### 12. Hopup

**Why it works**: "Hop" is a core brewing ingredient, and "hop up" means to enhance or boost something. As a tool name, it suggests upgrading/boosting your packages. Also, "hop" implies quick, light movement -- fitting for a lightweight tool.

- **CLI**: `$ hopup upgrade` or just `$ hopup`
- **Menu bar**: "Hopup"
- **Downsides**: 5 characters, excellent for typing. "Hop up" can also mean to get annoyed or agitated, or to modify something (like "hopped up on caffeine"). There's a marketplace app called "HopUp" for buying/selling firearms-related items -- not a direct technical conflict, but the name is taken in the app space.
- **Verdict**: Snappy and fun. The firearms marketplace association is a notable downside for discoverability/SEO.

### 13. Pourover

**Why it works**: A pour-over is a careful, methodical brewing technique -- you control every variable for the best result. This maps well to a tool that carefully manages upgrades and restarts rather than just blindly running `brew upgrade`. Implies precision and intentionality.

- **CLI**: `$ pourover upgrade`
- **Menu bar**: "Pourover"
- **Downsides**: 8 characters, slightly long. More associated with coffee than beer, which dilutes the Homebrew connection. Could be confused with "pore over" (to study carefully), though that's actually a nice secondary meaning.
- **Verdict**: Elegant and distinctive. The coffee association is a con for the brewing theme but the "careful methodology" angle is strong.

---

## Rankings

Tiered by overall fit for this tool:

### Tier 1: Strong Contenders

| Rank | Name | CLI Feel | App Feel | Key Strength |
|------|------|----------|----------|--------------|
| 1 | **Barback** | `$ barback upgrade` | "Barback" | Perfect metaphor -- the silent maintainer |
| 2 | **Brew Bouncer** | `$ bouncer upgrade` | "Brew Bouncer" | Best pun on the list (bounce = restart) |
| 3 | **Taproom** | `$ taproom upgrade` | "Taproom" | Natural Homebrew "tap" extension, professional |
| 4 | **Topoff** | `$ topoff` | "Topoff" | Dead simple, action-oriented |

### Tier 2: Solid Options

| Rank | Name | CLI Feel | App Feel | Key Strength |
|------|------|----------|----------|--------------|
| 5 | **Brewup** | `$ brewup` | "Brewup" | Most intuitive, slight namespace risk |
| 6 | **Rebrew** | `$ rebrew` | "Rebrew" | Self-explanatory, clean |
| 7 | **Last Call** | `$ lastcall` | "Last Call" | Memorable, great app name |
| 8 | **Growler** | `$ growler upgrade` | "Growler" | Fun, "fresh fill" angle |

### Tier 3: Interesting but Flawed

| Rank | Name | CLI Feel | App Feel | Key Strength |
|------|------|----------|----------|--------------|
| 9 | **Tapper** | `$ tapper upgrade` | "Tapper" | Catchy, arcade nostalgia |
| 10 | **Draught** | `$ draught upgrade` | "Draught" | Classy, spelling is a barrier |
| 11 | **Pourover** | `$ pourover upgrade` | "Pourover" | Precision angle, more coffee than beer |
| 12 | **Hopup** | `$ hopup` | "Hopup" | Snappy, name collision in app space |
| 13 | **Cellar** | `$ cellar upgrade` | "Cellar" | Homebrew namespace conflict, avoid |

---

## Recommendation

**Keep "Brew Bouncer" as the project name and use `bouncer` as the CLI binary.**

The reasoning:
- The bounce/restart pun is genuinely clever and specific to this tool's core feature
- "Brew Bouncer" works as a full app name; `bouncer` works as a short CLI command
- The "gatekeeper" connotation fits the future vision of a management dashboard
- It's already the working name, so there's no migration cost
- The only real competition is **Barback**, which has a slightly better metaphor for the maintenance angle but lacks the restart pun

If Jason wants to move away from the current name, **Barback** is the strongest alternative. **Taproom** is the safe, professional choice.

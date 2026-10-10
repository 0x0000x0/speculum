# Speculum Model Fields (plain English)

All saved files use `camelCase` names (e.g. `parentId`). Lists/maps below are sorted. Extra unknown fields are kept so old files still load.

## Object — a box on a diagram (person, system, app, store, part)

| Field | JSON name | Type | Meaning |
|---|---|---|---|
| id | `id` | text | Unique name-tag for this box |
| name | `name` | text | Display name, e.g. “Web App” |
| kind | `type` | actor/system/group/app/store/component | What sort of thing it is |
| parent_id | `parentId` | text or empty | Which bigger box it lives inside |
| status | `status` | live/future/deprecated/removed | Is it real, planned, or retired |
| external | `external` | yes/no | Is it outside your control |
| icon | `icon` | text or empty | Small picture name |
| caption | `caption` | text | One-line summary shown on the box |
| description | `description` | text | Long explanation (can be markdown) |
| tag_ids | `tagIds` | list of text | Colored labels attached |
| technologies | `technologies` | list of text | Tools used, e.g. “Rust” |
| links | `links` | list (name+url) | Web links for more info |
| group_ids | `groupIds` | list of text | Extra groups it belongs to |
| domain_id | `domainId` | text or empty | Business area it belongs to |
| labels | `labels` | word→word map | Free sticky-note labels |

Parent rules (warnings only): people/systems/groups sit inside a group or alone; apps/stores sit inside a system (or a group inside a system); parts sit inside an app or store.

## Connection — an arrow between two boxes

| Field | JSON | Type | Meaning |
|---|---|---|---|
| id | `id` | text | Unique tag |
| origin_id | `originId` | text | Where the arrow starts |
| target_id | `targetId` | text | Where the arrow ends |
| name | `name` | text | Label on the arrow |
| description | `description` | text | Longer explanation |
| direction | `direction` | outgoing/bidirectional/none | One-way, two-way, or plain line |
| status | `status` | live/future/deprecated/removed | Same as Object |
| line_shape | `lineShape` | curved/straight/square | How the line looks |
| label_position | `labelPosition` | number 0–1 or empty | Where along the line the label sits |
| via_id | `viaId` | text or empty | Small box drawn on top of the line (e.g. a queue) |
| tag_ids, technologies, links | | same as Object | Same idea as above |

## Tag / TagGroup / Domain

Tag: `id`, `name`, `color` (a paint name like “blue”), `groupId` (which group it is in), `index` (sort order). TagGroup: `id`, `name`, `icon`, `index`. Domain: `id`, `name`, `description`. A domain is a business area like “Shop”.

## Diagram — one drawing page

| Field | JSON | Meaning |
|---|---|---|
| id, name, description | | Title and notes |
| level | `level` | context/app/component (how deep you are) |
| scope_object_id | `scopeObjectId` | Which box this page zooms into; empty = whole picture |
| domain_id | `domainId` | Optional business area filter |
| order | `order` | Sort order; the lowest page is the default landing |
| pinned | `pinned` | Keep this page at the top |
| boxes | `boxes` | Which boxes are on this page + where they sit (x, y, width, height) |
| connections | `connections` | Which arrows are drawn on purpose + line tweaks |
| viewport | `viewport` | Saved pan/zoom (x, y, zoom) |
| landing | `landing` | “Clicking box X on this page jumps to page Y” |
| auto_placed | `autoPlaced` | Boxes were placed by magic, not by hand |
| created, modified | | Dates as text |

Removing a box from a page never deletes the real thing. One thing can have many pages.

## Flow — a click-through story (playback)

Step kinds: introduction, message, process, alternate-paths, parallel-paths, go-to-flow, information, conclusion.

FlowStep: `id`, `kind`, `title`, `description`, `originId`/`targetId`/`viaConnectionId` (who talks to whom over which arrow), `reversed` (play the arrow backwards = a reply), `objectId` (which box a “process” happens on), `goToFlowId` (jump to another story), `paths` (the branches for choice/parallel steps).
FlowPath: `id`, `name`, `steps`. Flow: `id`, `name`, `description`, `diagramId` (preferred page), `pinned`, `showAllConnectionNames`, `showAllSteps`, `steps` in play order.

## File wrapper / helpers

Document: `schema` (=1), `meta` (file `name`, `created`, `modified`), `model` (all objects, connections, tags, groups, domains, flows), `diagrams`. Model helpers: children, top-level boxes, parents, depth, group members, arrows in/out. Document helpers: pages for a zoom level, which page you land on, which pages contain a box, which stories mention something. `IdGen` makes numbered ids like `obj-1` without randomness.

## Checks, history, views, search

Check (validate): missing parents/links, loops, wrong parents, lonely arrows, missing labels, broken story steps, story steps that disagree with their arrow, empty stories, pages pointing at deleted things. Fix (repair) tidies all the hard errors without crashing. Change (command): every edit (add/change/move/delete boxes, arrows, labels, pages, stories, story steps) returns an “undo” that puts everything back exactly. History: undo/redo with a 500-step limit; fast typing on the same name merges into one undo step. View: pages roll small boxes up into their big parent (“lower” arrows), arrows from the page frame, hover highlights neighbours, stories pick the best page to play on. Search: finds boxes, arrows, pages and stories by name then summary; exact beats start-with beats contains beats letters-in-order beats 1-typo.

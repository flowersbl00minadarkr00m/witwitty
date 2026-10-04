import type { Depth } from '../core/contracts.js';
export interface ArticleBlock {
  id: string;
  section: string;
  source: string;
  explain: Record<Depth, string>;
  rewrite: Record<Depth, string>;
}
/** Original, purpose-written fixture. Fictional Meridian system; no third-party article copied. MIT. */
export const ARTICLE: ArticleBlock[] = [
  {
    id: 'log', section: 'A record is not a guarantee',
    source: 'A replicated log records proposed state transitions, but replication alone does not establish a single authoritative history. A replica can possess a durable entry that has not yet been committed. Treating persistence as agreement therefore confuses a local storage property with a system-wide ordering guarantee.',
    explain: {
      ELI5: 'Imagine several notebooks recording the same plan. Writing a plan safely into one notebook does not mean everyone has agreed to follow it. The passage separates saving a record from agreeing that the record counts.',
      Plain: 'Keeping copies of a log is not the same as agreeing on one history. A server may safely store a proposed change before the system accepts it. Storage durability and agreement answer different questions.',
      General: 'The passage distinguishes durability from commitment. Replication copies proposed changes; commitment establishes which changes belong to the agreed history. A locally durable record can still be uncommitted.',
      Advanced: 'Durability is local to a replica, whereas commitment constrains the distributed history. The existence of a replicated entry does not by itself establish the ordering or agreement conditions needed to treat that entry as authoritative.',
      Expert: 'Local persistence is not a commit predicate. The log can contain durable proposals outside the agreed prefix; inferring a global ordering guarantee from replica-local storage conflates distinct safety properties.',
    },
    rewrite: {
      ELI5: 'A copied log stores possible changes, but copying alone does not make one history the agreed history. A server can safely save an entry that the system has not accepted yet. Saving something and agreeing on its order are different guarantees.',
      Plain: 'A replicated log stores proposed changes, but copying it does not establish one accepted history. A replica may durably store an entry before it is committed. Local storage safety is therefore not the same as system-wide agreement on order.',
      General: 'A replicated log stores proposed state changes, but replication does not by itself establish one authoritative history. A durable entry on a replica may remain uncommitted. Persistence and system-wide ordering are different guarantees.',
      Advanced: 'Replication propagates proposed state transitions without independently establishing an authoritative history. Replica-local durability can precede commitment. Persistence must therefore be distinguished from a system-wide ordering guarantee.',
      Expert: 'A replicated log can retain durable, uncommitted proposals. Replication alone does not establish an authoritative history; replica-local persistence must not be conflated with system-wide ordering agreement.',
    },
  },
  {
    id: 'quorum', section: 'A record is not a guarantee',
    source: 'In the Meridian prototype, each shard maintains 5 replicas and requires acknowledgments from 3 replicas before marking an entry committed. Any two such majorities intersect. This intersection is necessary for the proposed coordination scheme, but it is not sufficient by itself to guarantee linearizable reads.',
    explain: {
      ELI5: 'Meridian has 5 copies and waits for 3 replies before accepting an entry. Any two groups of 3 must share a member. That overlap matters, but it does not alone make every read behave as though all operations happened in one real-time order.',
      Plain: 'The prototype waits for a majority: 3 of its 5 replicas. Two majorities must overlap. The text warns that this overlap is only one part of the design; it does not by itself guarantee correctly ordered reads.',
      General: 'A quorum is the required set of participating replicas. Here, 3 acknowledgments out of 5 create intersecting majorities. Quorum intersection supports coordination, but additional protocol rules are needed for linearizable reads.',
      Advanced: 'The 3-of-5 acknowledgment rule ensures pairwise majority intersection. The passage deliberately limits the consequence of that arithmetic: quorum intersection alone does not specify a read protocol or establish linearizability.',
      Expert: 'For 5 replicas and a commit quorum of 3, majority quorums intersect. The stated necessary condition is not a sufficient linearizability argument; read semantics and the remaining coordination rules are unspecified.',
    },
    rewrite: {
      ELI5: 'Meridian keeps 5 copies of each shard. It accepts an entry after 3 copies reply. Any two groups that contain more than half the copies overlap. The design needs that overlap, but overlap alone does not guarantee reads that respect a single real-time order.',
      Plain: 'Each shard in Meridian has 5 replicas. An entry is marked committed after 3 replicas acknowledge it. Any two majorities overlap. This overlap is needed for the planned coordination scheme, but does not alone guarantee linearizable reads.',
      General: 'Meridian maintains 5 replicas per shard and commits an entry after acknowledgments from 3. Any two majorities intersect. That intersection is necessary for this coordination scheme, but does not independently guarantee linearizable reads.',
      Advanced: 'Meridian uses 5 replicas per shard and a commit threshold of 3 acknowledgments. Majority intersection is necessary for the proposed scheme, but is not independently sufficient for read linearizability.',
      Expert: 'Meridian commits on 3 acknowledgments across 5 replicas per shard. Pairwise majority intersection is a necessary condition of the proposed coordination scheme, not a sufficient condition for linearizable reads.',
    },
  },
  {
    id: 'causality', section: 'What the reader is allowed to know',
    source: 'A client that observes one write may reasonably expect its subsequent read to include that write. This read-your-writes expectation constrains the history visible to that client, not necessarily the histories visible to other clients. A session token can carry the required version boundary without asserting a total order over unrelated operations.',
    explain: {
      ELI5: 'After you make a change, you expect to see it when you look again. That promise can apply to you without making everyone else see exactly the same history. A session token can remember how far your view needs to have caught up.',
      Plain: 'Read-your-writes means your later reads include a write you have already observed. It is a promise about your session, not all clients. A session token can identify the minimum version you need to see.',
      General: 'The passage separates a client-local session guarantee from global ordering. A version boundary carried in a session token can enforce read-your-writes without ordering unrelated operations across the entire system.',
      Advanced: 'Read-your-writes constrains a client’s observable history. A session-carried version boundary can enforce that constraint without claiming a total order for concurrent or unrelated operations.',
      Expert: 'The session token encodes a visibility lower bound, not a global serialization order. Read-your-writes is a per-client history constraint and does not entail equivalence of histories observed by different clients.',
    },
    rewrite: {
      ELI5: 'A client that has seen a write may expect its next read to include it. This promise concerns that client, not necessarily other clients. A session token can record the oldest acceptable version without putting unrelated operations into one total order.',
      Plain: 'After observing a write, a client may expect to see it in its next read. Read-your-writes limits that client’s view, not necessarily everyone else’s. A session token can mark the required version without totally ordering unrelated operations.',
      General: 'Read-your-writes means a client’s subsequent read should include a write it has observed. This constrains that client’s history rather than every client’s history. A session token can carry the required version boundary without imposing a total order on unrelated operations.',
      Advanced: 'Read-your-writes constrains subsequent visibility for the observing client, not necessarily for other clients. A session token can encode the required version boundary without asserting a total order over unrelated operations.',
      Expert: 'An observing client’s read-your-writes expectation is a session-local visibility constraint. Its token may encode a version lower bound without asserting either shared histories across clients or a total order over unrelated operations.',
    },
  },
  {
    id: 'retries', section: 'The acknowledgment problem',
    source: 'An acknowledgment can be lost after the operation has completed. Retrying a request therefore does not prove that the original attempt failed. The prototype assigns an idempotency key to each logical operation and records the outcome with that key, so a retry can recover the prior result instead of applying the same transition again.',
    explain: {
      ELI5: 'Not hearing “done” does not mean the work was not done. The reply might have been lost. Meridian gives each piece of work a label, so asking again can return the old result instead of doing the work twice.',
      Plain: 'A missing reply leaves the outcome uncertain. An idempotency key identifies the same logical operation across retries. Recording the result with that key lets a retry return the prior result rather than repeat the change.',
      General: 'The passage distinguishes an uncertain acknowledgment from an unsuccessful operation. The idempotency key ties repeated requests to one logical transition, allowing the stored outcome to be recovered.',
      Advanced: 'A lost acknowledgment creates outcome ambiguity. Persisting an operation’s result under its idempotency key allows a retried request to recover that result without reapplying the state transition.',
      Expert: 'Acknowledgment loss does not imply execution failure. Operation-scoped idempotency keys and recorded outcomes permit result recovery across retries without duplicate transition application.',
    },
    rewrite: {
      ELI5: 'The operation may finish even when its reply gets lost. Sending the request again does not show that the first try failed. Meridian labels each logical operation with an idempotency key and saves its result under that key. A retry can then get the saved result rather than make the same change again.',
      Plain: 'An operation can finish before its acknowledgment is lost. A retry does not prove the first attempt failed. Meridian gives each logical operation an idempotency key and saves its outcome with the key, letting retries recover the result rather than repeat the change.',
      General: 'Losing an acknowledgment after completion makes the outcome uncertain, not necessarily unsuccessful. Meridian records each logical operation’s outcome under an idempotency key, so retries can retrieve the existing result instead of repeating the transition.',
      Advanced: 'A lost acknowledgment can follow successful execution; a retry is not evidence of initial failure. Meridian associates each logical operation and its recorded outcome with an idempotency key, permitting result recovery without duplicate application.',
      Expert: 'Acknowledgment loss leaves execution outcome ambiguous. Meridian keys logical operations and recorded outcomes by idempotency key, allowing retries to recover prior results without reapplying the transition.',
    },
  },
  {
    id: 'backpressure', section: 'Backpressure is a correctness concern',
    source: 'When producers outrun consumers, an unbounded queue converts a temporary throughput mismatch into persistent memory pressure. Meridian applies backpressure before accepting more work and exposes the resulting delay to the caller. This choice sacrifices immediate admission rather than silently accumulating an unlimited amount of unfinished work.',
    explain: {
      ELI5: 'If work arrives faster than it can be finished, the waiting pile keeps growing. Meridian slows down new work before that pile gets out of control. The caller sees the delay instead of the system hiding an unlimited backlog.',
      Plain: 'Backpressure slows the arrival of new work when the system cannot keep up. Meridian delays accepting work rather than storing an unlimited queue, and makes that delay visible to callers.',
      General: 'The passage treats admission control as a deliberate resource bound. Backpressure exposes the producer–consumer mismatch to the caller instead of allowing an unbounded queue to turn it into sustained memory pressure.',
      Advanced: 'An unbounded queue can prolong memory pressure after a temporary throughput imbalance. Meridian bounds admission through caller-visible backpressure rather than absorbing arbitrary unfinished work.',
      Expert: 'Meridian externalizes overload at admission instead of internalizing it as unbounded queue growth. Caller-visible backpressure trades immediate acceptance for bounded unfinished work under producer–consumer imbalance.',
    },
    rewrite: {
      ELI5: 'When new work arrives faster than it is finished, a queue with no limit can keep using more memory even after a brief slowdown. Meridian slows new work before accepting it and shows callers the delay. It chooses waiting at the entrance instead of hiding an unlimited pile of unfinished work.',
      Plain: 'An unlimited queue can turn a brief gap between incoming and completed work into lasting memory pressure. Meridian uses backpressure before accepting more work and shows the delay to callers. It delays admission instead of silently accumulating unlimited unfinished work.',
      General: 'If producers outpace consumers, an unbounded queue can turn a temporary mismatch into persistent memory pressure. Meridian makes backpressure visible before admission, delaying acceptance rather than silently collecting unlimited unfinished work.',
      Advanced: 'Unbounded buffering can convert a transient throughput imbalance into sustained memory pressure. Meridian applies caller-visible backpressure before admission, trading immediate acceptance for a bound on unfinished work.',
      Expert: 'Meridian applies caller-visible, pre-admission backpressure rather than buffering unbounded unfinished work. It trades immediate admission for bounded accumulation when producer throughput exceeds consumer throughput.',
    },
  },
  {
    id: 'observability', section: 'Backpressure is a correctness concern',
    source: 'Operational metrics must distinguish accepted requests, completed transitions, and acknowledged results. A single success counter obscures the gaps between these stages. The demonstration therefore records each stage separately and treats a timeout as an unknown outcome until the operation record resolves it.',
    explain: {
      ELI5: '“Received,” “finished,” and “told the caller” are different steps. Counting all three as one kind of success hides where things go wrong. A timeout means the result is unknown until the stored record tells us what happened.',
      Plain: 'The system counts acceptance, completion and acknowledgment separately. A single success count would hide missing steps. A timed-out request has an unknown result until its operation record settles the question.',
      General: 'The passage makes observability match the operation lifecycle. Separate counters reveal gaps between admission, execution and acknowledgment; a timeout is not classified as failure until the operation record resolves its outcome.',
      Advanced: 'Lifecycle-specific metrics preserve the distinction between admission, transition completion and result acknowledgment. The operation record, rather than the timeout alone, resolves an ambiguous execution outcome.',
      Expert: 'Observability preserves distinct admission, execution and acknowledgment events. Timeout is epistemic uncertainty about outcome; the operation record is the specified resolution mechanism.',
    },
    rewrite: {
      ELI5: 'The metrics need separate counts for requests accepted, changes finished, and results acknowledged. One success count hides the differences. This demonstration records each step on its own. A timeout leaves the result unknown until the operation record settles it.',
      Plain: 'Metrics should count accepted requests, completed changes and acknowledged results separately. One success counter hides the gaps. The demonstration records each stage and treats a timeout as an unknown result until the operation record resolves it.',
      General: 'Metrics distinguish request acceptance, transition completion and result acknowledgment. A single success counter hides their differences. This demonstration records the stages separately and uses the operation record to resolve a timed-out request’s unknown outcome.',
      Advanced: 'Metrics must separate admission, transition completion and acknowledgment. A single success counter obscures inter-stage gaps. The demonstration records each stage and leaves timeout outcomes unresolved until the operation record determines them.',
      Expert: 'The demonstration instruments admission, completion and acknowledgment separately. It avoids a conflated success counter and treats timeout as outcome uncertainty pending resolution by the operation record.',
    },
  },
];
export const TERM_MEANINGS: Record<string, {
  definition: string;
  simpler: string;
  expert: string;
}> = {
  quorum: { definition: 'The required group of replicas participating in a decision; here, the relevant threshold is 3 out of 5.', simpler: 'required group of replicas', expert: 'A participating subset satisfying the protocol’s acknowledgment threshold; intersection alone is not a linearizability proof.' },
  replicas: { definition: 'Copies of the shard’s data maintained by different participants in this prototype.', simpler: 'copies', expert: 'Participants maintaining replicated shard state; local state may include uncommitted proposals.' },
  replication: { definition: 'Keeping copies of the log or data across replicas; copying alone is not agreement on an authoritative history.', simpler: 'copying across replicas', expert: 'Propagation of state or log entries across replicas, distinct from commitment and global ordering.' },
  linearizable: { definition: 'Reads consistent with operations appearing to take effect in a single order that respects real-time ordering. The passage does not claim quorum overlap alone supplies this guarantee.', simpler: 'consistent with a single real-time order', expert: 'Compatible with a sequential history respecting real-time precedence; not implied by quorum intersection in isolation.' },
  idempotency: { definition: 'In “idempotency key,” the key connects retries to one logical operation so that the recorded result can be recovered without repeating its transition.', simpler: 'duplicate-prevention', expert: 'Here, an operation-identity mechanism supporting outcome recovery and duplicate-application suppression across retries.' },
  backpressure: { definition: 'Slowing admission of new work when producers outrun consumers, making the delay visible instead of building an unlimited queue.', simpler: 'slowing new work', expert: 'Caller-visible admission control that bounds accumulation under producer–consumer throughput imbalance.' },
  committed: { definition: 'Accepted into the system’s agreed history under the prototype’s protocol, not merely stored on one replica.', simpler: 'accepted into the agreed history', expert: 'Satisfying the protocol’s commit condition, distinct from replica-local persistence.' },
  durable: { definition: 'Persistently stored on a replica; in this passage, durable storage does not imply that an entry has been committed.', simpler: 'persistently stored', expert: 'Satisfying the local persistence property without necessarily satisfying the distributed commit predicate.' },
};
export function fixtureFor(source: string): ArticleBlock | undefined {
  return ARTICLE.find(block => block.source === source || (source.length > 40 && block.source.includes(source)));
}
/** Exact-match scope fixtures: no summary is silently applied to a different article. */
const IMPLEMENTATION_TEXT = [
  'The commitIndex marker tracks the applied boundary. A quorum is useful only in the context of the protocol that interprets it.',
  'Keep request identity stable across retries.',
  'Preserve the distinction between a timeout and a failed operation.',
  'if (entry.index <= commitIndex) apply(entry);',
  'R + W > N',
  'A durable observation is not automatically a complete explanation.',
];
const DOCUMENT_OVERVIEW: Record<Depth, string> = {
  ELI5: 'Saving a change, agreeing that it counts, showing it to a reader, and telling the caller it finished are different things. Meridian keeps 5 copies and needs 3 replies, but that overlap alone is not enough to make every read correctly ordered. It also keeps track of what each reader must see, labels retries so work is not repeated, slows incoming work when necessary, and records each step separately. The main idea: a record of one step is not proof that the whole job succeeded.',
  Plain: 'The article argues that a distributed system needs separate promises for storage, agreement, what clients can read, retries, and overload. Meridian’s 3-of-5 acknowledgment rule gives overlapping majorities but does not by itself guarantee linearizable reads. Session tokens, idempotency keys, visible backpressure and separate lifecycle metrics address different parts of the problem. A timeout leaves an outcome unknown; it does not prove failure.',
  General: 'The central argument is that local evidence should not be mistaken for a stronger system-wide guarantee. Durability differs from commitment; majority intersection differs from read linearizability; session visibility differs from a global total order. The Meridian example connects these distinctions to idempotent result recovery, bounded admission and lifecycle-specific observability. Correct interpretation depends on the protocol and the stage an observation actually establishes.',
  Advanced: 'The article decomposes distributed-system guarantees instead of treating replication as a universal correctness mechanism. It separates persistence from commitment, quorum intersection from linearizability, and session-local visibility constraints from global ordering. Operation identity resolves ambiguous retry outcomes; pre-admission backpressure bounds unfinished work; stage-specific metrics preserve the distinction between acceptance, completion and acknowledgment. The implementation notes reinforce that records and thresholds need protocol context.',
  Expert: 'The thesis is evidentiary: a replica-local fact is not automatically a distributed safety predicate. The Meridian narrative separates commit, visibility and acknowledgment semantics; limits the inference from quorum intersection; and treats timeout as outcome uncertainty. Idempotency-keyed recovery, admission backpressure and lifecycle instrumentation address distinct failure modes rather than strengthening replication by assertion. The protocol, not the mere presence of a log entry or counter, determines the warranted conclusion.',
};
const SECTION_OVERVIEWS: Record<Depth, string>[] = [
  {
    ELI5: 'A copy can safely store a proposed change before the system agrees to use it. Meridian waits for 3 replies from 5 copies. Those groups overlap, but overlap alone does not prove that reads happen in the right order. Saving, agreeing and reading correctly are different promises.',
    Plain: 'This section separates safe storage from agreement on a history. Meridian commits after 3 of its 5 replicas acknowledge an entry. Majority overlap is required for this scheme, but additional protocol rules are needed to guarantee linearizable reads.',
    General: 'The argument distinguishes replica-local durability, commitment and read consistency. The 3-of-5 threshold ensures intersecting majorities; it does not turn local persistence or quorum arithmetic into a complete linearizability guarantee.',
    Advanced: 'Durability and commitment are different predicates. Meridian’s 3-of-5 acknowledgment rule establishes majority intersection, a necessary condition of the proposed coordination scheme, but does not specify enough of the read protocol to establish linearizability.',
    Expert: 'Replica-local persistence does not imply membership in an authoritative history. The proposed commit quorum intersects for 5 replicas and a threshold of 3, but intersection is not a sufficient read-linearizability argument. Storage, commit and visibility semantics remain distinct.',
  },
  {
    ELI5: 'You may need your next read to include a change you already saw, without everyone seeing the same history. Separately, a lost reply does not mean a job failed. Meridian carries a version marker for the reader and a saved result under a retry key for the operation.',
    Plain: 'This section distinguishes what a client must be able to read from what happened to an operation. A session token can preserve read-your-writes without globally ordering unrelated work. An idempotency key can recover a completed result after a lost acknowledgment instead of repeating the change.',
    General: 'The section addresses two kinds of uncertainty: session-visible history and an operation’s outcome after acknowledgment loss. Version boundaries constrain one client’s reads; idempotency-keyed outcome records support retry recovery. Neither mechanism should be mistaken for a universal ordering guarantee.',
    Advanced: 'Session tokens encode a visibility lower bound rather than a global total order. Idempotency keys address a separate concern: recovering an operation outcome whose acknowledgment was lost without reapplying its transition. Client visibility and duplicate suppression have different contracts.',
    Expert: 'The section separates session-local history constraints from operation-identity semantics. Read-your-writes does not entail equivalent histories across clients. Idempotency-keyed outcome recovery resolves ambiguous acknowledgment loss without inferring that the initial execution failed or repeating the transition.',
  },
  {
    ELI5: 'When work comes in too fast, Meridian makes new callers wait rather than hiding an endless pile of unfinished jobs. It counts “accepted,” “finished” and “acknowledged” separately. A timeout means the result is still unknown until the operation record explains it.',
    Plain: 'The section links bounded admission with honest reporting. Meridian exposes backpressure instead of letting a queue grow without limit. Separate acceptance, completion and acknowledgment metrics reveal gaps that one success counter would hide. Timeouts remain unresolved until the operation record settles them.',
    General: 'Backpressure makes resource constraints visible at admission, while lifecycle-specific metrics make execution uncertainty visible after admission. The argument rejects both unlimited hidden buffering and a conflated success counter. A timeout alone is not an outcome determination.',
    Advanced: 'Caller-visible admission backpressure prevents transient throughput imbalance from becoming unbounded unfinished work. Separate admission, completion and acknowledgment instrumentation preserves inter-stage gaps. Timeout outcomes remain unknown pending resolution from the operation record.',
    Expert: 'This section pairs explicit overload externalization with epistemically precise observability. Pre-admission backpressure bounds accumulation; stage-specific metrics avoid conflating admission, execution and acknowledgment. The operation record resolves timeout ambiguity instead of a single success counter implying more than it establishes.',
  },
];
export function scopeFixture(source: string, depth: Depth): string | undefined {
  const core = ARTICLE.map(block => block.source).join('\n\n');
  if (source === core || source === [...ARTICLE.map(block => block.source), ...IMPLEMENTATION_TEXT].join('\n\n'))
    return DOCUMENT_OVERVIEW[depth];
  for (let index = 0; index < 3; index++) {
    const pair = ARTICLE.slice(index * 2, index * 2 + 2).map(block => block.source).join('\n\n');
    if (source === pair)
      return SECTION_OVERVIEWS[index]?.[depth];
  }
  return undefined;
}
/** Sentence paraphrases are also usable as meaning-preserving rewrites: no extra facts. */
export const SENTENCE_FIXTURES: Record<string, Record<Depth, string>> = {
  'A replicated log records proposed state transitions, but replication alone does not establish a single authoritative history.': {
    ELI5: 'A copied log records possible changes, but making copies does not by itself make one history the agreed history.',
    Plain: 'A replicated log stores proposed changes, but copying it alone does not establish one accepted history.',
    General: 'A replicated log records proposed changes; replication by itself does not establish a single authoritative history.',
    Advanced: 'Replication propagates a log of proposed state transitions without independently establishing an authoritative history.',
    Expert: 'A replicated proposal log does not, by replication alone, determine a unique authoritative history.',
  },
  'A replica can possess a durable entry that has not yet been committed.': {
    ELI5: 'One copy can safely store an entry that the system has not yet accepted.',
    Plain: 'A replica can store an entry durably before that entry is committed.',
    General: 'An entry can be durable on a replica while remaining uncommitted.',
    Advanced: 'Replica-local durability does not require that the entry has already reached commitment.',
    Expert: 'Durability at a replica can precede satisfaction of the entry’s commit condition.',
  },
  'Treating persistence as agreement therefore confuses a local storage property with a system-wide ordering guarantee.': {
    ELI5: 'Calling saved data “agreement” mixes up what one copy stores with what the whole system promises about order.',
    Plain: 'Treating persistence as agreement confuses local storage safety with a guarantee about ordering across the system.',
    General: 'Equating persistence with agreement conflates a local storage property and a system-wide ordering guarantee.',
    Advanced: 'Inferring agreement from persistence mistakes a replica-local storage property for a distributed ordering guarantee.',
    Expert: 'Persistence-as-agreement conflates local storage semantics with a system-wide ordering predicate.',
  },
  'In the Meridian prototype, each shard maintains 5 replicas and requires acknowledgments from 3 replicas before marking an entry committed.': {
    ELI5: 'Meridian keeps 5 copies of each shard and marks an entry accepted only after 3 copies reply.',
    Plain: 'Each Meridian shard has 5 replicas. An entry is marked committed after acknowledgments from 3 replicas.',
    General: 'Meridian maintains 5 replicas per shard and requires 3 acknowledgments before marking an entry committed.',
    Advanced: 'The Meridian prototype uses 5 replicas per shard with a commit-marking threshold of 3 replica acknowledgments.',
    Expert: 'Meridian marks an entry committed on 3 acknowledgments from its shard’s 5 replicas.',
  },
  'Any two such majorities intersect.': {
    ELI5: 'Any two groups of that majority size share at least one member.',
    Plain: 'Any two of these majorities overlap.',
    General: 'Every pair of such majority groups has a shared member.',
    Advanced: 'Such majority sets have a nonempty pairwise intersection.',
    Expert: 'These majority quorums intersect pairwise.',
  },
  'This intersection is necessary for the proposed coordination scheme, but it is not sufficient by itself to guarantee linearizable reads.': {
    ELI5: 'The planned scheme needs the overlap, but overlap alone does not guarantee reads that respect one real-time order.',
    Plain: 'The proposed coordination scheme needs this intersection, but the intersection alone does not guarantee linearizable reads.',
    General: 'Intersection is necessary for the proposed scheme but does not by itself ensure read linearizability.',
    Advanced: 'Quorum intersection is required by the proposed coordination scheme, not independently sufficient for linearizable reads.',
    Expert: 'For the proposed scheme, intersection is a necessary but not sufficient condition for read linearizability.',
  },
};

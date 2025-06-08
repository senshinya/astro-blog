---
title: Raft Paper Notes
tags: ["raft", "6.5840", "6.824"]
lang: en
published: 2022-12-03T21:40:09+08:00
abbrlink: notes/65840/reftextendedpaper
description: "Raft is a consensus algorithm designed to improve the efficiency of log replication, especially suitable for multi-node clusters, ensuring continued service even when some machines fail. This algorithm follows a replicated state machine model, utilizing logs to preserve command order, enabling all machines in a cluster to reach a consistent state. The paper 'In Search of an Understandable Consensus Algorithm' delves into Raft's design philosophy and its comparison with Paxos, highlighting its approachable and easy-to-understand nature, and providing a foundation for building reliable large-scale software systems. This post documents my reading notes on the paper and aims to help unpack its core concepts and applications."
---
### Introduction

Raft is a consensus algorithm used for managing replicated logs. Consensus algorithms are used in clusters with multiple machines to ensure that services remain available even if some of the machines fail. Because of this, consensus algorithms play a critical role in building reliable, large-scale software systems.

The core reference for Raft is the paper *In Search of an Understandable Consensus Algorithm (Extended Version)*, which can be read [here](https://raft.github.io/raft.pdf). The paper is concise (just 18 pages) and makes multiple comparisons between Raft and Paxos (including some complaints at the start), all designed to highlight Raft’s biggest strength: it’s more understandable.

These are my personal notes from reading the paper.

### Background

Consensus algorithms were primarily introduced for the replicated state machine model. Replicated state machines are commonly implemented with replicated logs, where each log holds a series of commands. Every machine in the cluster executes these commands in the same order, leading to identical states. Note the word *eventually*: this is eventual consistency, not strong consistency.

The consensus algorithm guarantees that these replicated logs remain continuous across the cluster. Consensus modules on each node communicate with each other to ensure that every server ultimately executes the same commands in the same order—even if some nodes crash. This allows the entire cluster to act as a single fault-tolerant service.

Consensus algorithms are only applicable in non-Byzantine environments, that is, where nodes do not deliberately forge information.

### Algorithm Overview

The Raft consensus algorithm is divided into three fairly independent modules:

- **Leader Election**: If an existing leader fails, a new leader must be chosen.
- **Log Replication**: The leader accepts log entries from clients and replicates them across the cluster, ensuring logs on other machines are consistent with its own.
- **Safety**: If any server applies a command at a given log index, no other server will ever apply a different command at that same index.

#### Raft Basics

In a Raft cluster, at any time, each server is in one of three states:

- **Leader**: Handles all client requests.
- **Follower**: Passive, only responds to requests from leaders and candidates.
- **Candidate**: Enters this state to attempt to become the leader.

Under normal operations, there is one leader and all other servers are followers.

Raft divides time into terms. Each term starts with an election, during which one or more candidates attempt to become leader. If a candidate wins the election, it becomes the leader for that term, and the other servers become followers.

A term is a monotonically increasing integer, stored by each server, and included in messages exchanged across the cluster. If a server discovers its term is out-of-date, it updates itself to the latest term. Candidates or leaders discovering their term is behind immediately revert to follower.

Communication between Raft nodes is basically two RPC types:

- **RequestVote RPCs**: Initiated by candidates during leader election.
- **AppendEntries RPCs**: Sent by the leader to replicate logs and to serve as heartbeats.

#### Leader Election

Servers start as followers, and remain so as long as they receive the proper RPCs. The leader periodically issues empty AppendEntries as heartbeats to maintain control. If a follower fails to receive these for some duration, it begins an election.

A follower starting an election transitions to candidate, increments its term, votes for itself, and concurrently requests votes from the other servers. A candidate stays in this state until one of three things happens:

1. If a candidate receives votes from the majority, it becomes leader. Each server votes for at most one candidate per term (first-come, first-served), ensuring only one leader at a time. Once leader, it begins sending heartbeats to assert control.
2. If the candidate receives an AppendEntries RPC from another leader with an equal or higher term, it steps down to follower; otherwise, it rejects the RPC and remains candidate.
3. If many followers become candidates simultaneously, it’s possible no one wins. In this case, candidates time out, increment their term, and start a new election.

To prevent endless election collisions (case 3), election timeouts are randomized within a fixed range, lowering the chance of simultaneous election timeouts.

#### Log Replication

Each client request contains a command to be executed by the state machine. Upon receiving a command, the leader appends it to its log and concurrently issues AppendEntries RPCs with that command to other servers. Once entries are replicated to a majority, the leader commits the command to the state machine and responds to the client.

Every AppendEntries RPC includes the entry to be replicated, the leader’s current term, and the entry’s log index.

When the leader successfully replicates an entry to a majority, it commits the entry. Raft guarantees that committed entries are durable and will eventually be executed by all available state machines. Committing an entry also commits all preceding entries, even those created by prior leaders. The leader tracks the highest log index to be committed and includes this in all AppendEntries. When followers learn through entries that an item has been committed, they apply it to their state machines as well.

Raft enforces these two rules:

- If two entries have the same term and index, they must contain identical commands.
- If two log entries have the same term and index, all preceding entries are identical as well.

The first rule is straightforward; the second deserves attention.

When sending AppendEntries, the leader includes the previous log entry’s term and index. If the follower lacks such a log entry, it rejects the request: this is a consistency check. Only when the request succeeds can the leader be sure the follower’s log matches its own.

If the check fails, the leader forces the follower’s log to match its own: it finds the last matching entry, deletes all subsequent entries on the follower, and sends any missing entries. The leader maintains a *nextIndex* for each follower, its next log index to send. At startup, all followers’ nextIndex are initialized as the leader’s last log index + 1. If an AppendEntries fails, the leader decrements that follower's nextIndex and retries.

> The text is a bit ambiguous here. My understanding: each AppendEntries sends entries starting from nextIndex, so if the consistency check passes, missing entries can be synchronized all at once.

#### Safety

The above mechanisms don’t fully guarantee safety; for instance, a server might go offline, miss several committed entries, then return and get elected leader, possibly overwriting committed entries. To handle this, Raft adds an election restriction: a leader for any term must have all logs committed in previous terms.

To enforce this, each RequestVote includes the candidate’s log info. If a voter’s log is more up to date (last log term/index higher), it denies the request.

Also, if a log entry from the current term is replicated to a majority, the leader considers it committed. If a leader crashes after doing so, the next leader will attempt to complete replication of that entry. Leaders cannot instantly know if an entry from an earlier term is committed, even if it’s on a majority of servers (see Figure 8 in the paper). So Raft only looks at the latest term’s entries to determine commit status: once an entry from the current term is committed, all prior entries become implicitly committed.

#### Cluster Membership Changes

To change cluster membership without downtime, Raft avoids situations where two separate "clusters" could each elect their own leader.

Raft uses a two-phase approach for configuration changes. First, the cluster switches to a joint consensus configuration—an overlap of old and new configurations. After this is committed, the system transitions to the new configuration. During joint consensus:

- Logs are replicated to ALL servers in both the old and new configs.
- Servers from both configs can be leaders.
- Elections and appends require majorities from BOTH configs.

Config changes are stored and replicated as special entries in the log, as follows:

1. The leader receives a request to switch from `C_old` to `C_new`.
2. The leader stores the union (`C_old,new`) as a joint consensus config in a log entry.
3. This log entry is replicated to all servers in both configurations.
4. As soon as any server appends this entry (not yet committed), it switches to the joint config for all processing.
5. When the joint entry is committed by a majority, the leader creates a new log entry with just `C_new`, replicates to all, and commits.

Membership changes have three main issues:

1. New servers lack logs and need time to catch up, temporarily reducing cluster availability. Raft adds an additional step: new servers receive log entries but aren’t voting members until they’re up to date, so consensus does not depend on them.
2. The leader may not be part of the new configuration. If so, as soon as `C_new` is committed, it steps down, and for a time, manages a cluster that doesn’t include itself, applying logs but not considering itself for leadership.
3. Removed servers might disrupt the cluster; they’re no longer receiving heartbeats and keep starting elections, sending vote requests with higher terms and potentially causing the leader to step down. Successive elections will keep occurring, reducing availability.

To mitigate issue 3, Raft adds a rule: if a server receives a RequestVote within its heartbeat timeout window, it neither updates its term nor votes—so a leader can hold its ground as long as it continues sending heartbeats to its current cluster.

#### Log Compaction (Snapshotting)

As logs grow, servers can’t keep all entries in memory. Snapshots mitigate this: servers periodically save the state machine’s current state to stable storage. Log entries leading up to the snapshot point can then be deleted.

Each server manages its own snapshot, which only includes committed log entries. In addition to the state machine state, snapshots must include the index and term of the latest included log entry (for AppendEntries consistency checks). Snapshots should also save the cluster configuration as of the snapshot, if membership changes are supported. Once a snapshot is completed, all logs and snapshots before that point can be discarded.

Sometimes, a leader needs to bring a lagging or new follower up to date by sending a snapshot using a new RPC: `InstallSnapshot`.

```go
type InstallSnapshotRequest struct {
    // Term: leader’s term
    Term              int64
    // LeaderID: so follower can redirect clients
    LeaderID          int64
    // LastIncludedIndex: index of last entry in snapshot
    LastIncludedIndex int64
    // LastIncludedTerm: term of last entry in snapshot
    LastIncludedTerm  int64
    // Offset: byte offset in snapshot chunk
    Offset            int64
    // Data: snapshot chunk data
    Data              []byte
    // Done: true if this is the last chunk
    Done              bool
}

type InstallSnapshotResponse struct {
    // Term: follower’s current term
    Term    int64
}
```

Follows this process:

1. If `Term` < `CurrentTerm`, return immediately.
2. If `Offset` is 0, begin writing a new snapshot.
3. Write `Data` at the appropriate offset.
4. If `Done` is false, return and await the next chunk.
5. If the log contains an entry matching `LastIncludedIndex` and `LastIncludedTerm`, retain that and all later entries.
6. Else, discard the entire log.
7. Replace the state machine and configuration using the snapshot.

Often, snapshots will contain entries the follower does not have, so it will discard its log. If the follower already has all the log entries, the snapshot replaces the log up to that point, but entries past the snapshot are retained.

Snapshots affect performance. It’s best to trigger snapshotting when the log exceeds a certain size (not too big or small), as large snapshots are slow and small ones are too frequent. Since disk I/O is slow, snapshotting can block normal processing. Raft recommends using copy-on-write so that log appends and processing can continue while a snapshot is being written.

#### Client Interaction

All client requests are handled by the cluster’s leader. A client may initially send its request to any server; if it’s not the leader, that server will reject the request and return the address of the last known leader. If the leader fails before responding, the client’s request times out and it tries another random server.

Raft aims for linearizable semantics, meaning each operation appears to occur atomically, exactly once. However, if a leader executes an operation and crashes before replying, the client may retry with a new leader, potentially causing the operation to execute twice. This is addressed by having clients tag each request with a unique, monotonically increasing ID, and the state machine keeps track of the last executed ID for each client. If a request with a duplicate ID arrives, the state machine replies immediately without re-executing.

Read-only requests need not be committed to the log, so consensus is not required. However, if a leader is unaware it's been superseded, it might return stale data. Raft prevents this by:

1. Ensuring the leader has applied all committed log entries. This is tackled by having the leader append a no-op log entry at the start of its tenure to discover committed entries.
2. Before processing a read-only request, the leader verifies it still has leadership by exchanging heartbeats with a majority of the cluster.

### Reference Implementation

Figure 2 of the paper provides a detailed reference implementation (this is why Raft is awesome!), excluding dynamic membership and log compaction.

#### Server State

```go
type ServerState struct {
    /***** Persistent state on all servers *****/
    // CurrentTerm: latest term server has seen (init 0, increases monotonically)
    CurrentTerm int64;
    // VotedFor: candidateId that received vote in current term (or nil if none)
    VotedFor    *int64;
    // Logs: log entries, each contains a command and term (index starts from 1)
    Logs        []*Log;

    /***** Volatile state on all servers *****/
    // CommitIndex: index of highest log entry known to be committed (init 0)
    CommitIndex int64;
    // LastApplied: index of highest log entry applied to state machine (init 0)
    LastApplied int64;

    /***** Volatile state on leaders, re-initialized after election *****/
    // NextIndex: for each server, index of the next log entry to send (init leader's last log index + 1)
    NextIndex  []int64;
    // MatchIndex: for each server, index of highest log entry known to be replicated (init 0)
    MatchIndex []int64;
}
```

#### AppendEntries RPC

```go
type AppendEntriesRequest struct {
    // Term: leader’s term
    Term         int64
    // LeaderID: so follower can redirect clients
    LeaderID     int64
    // PrevLogIndex: index of log entry immediately preceding new ones
    PrevLogIndex int64
    // PrevLogTerm: term of prevLogIndex entry
    PrevLogTerm  int64
    // Entries: log entries to store (empty for heartbeat)
    Entries      []*Log
    // LeaderCommit: leader’s commitIndex
    LeaderCommit int64
}
 
type AppendEntriesResponse struct {
    // Term: current term, for leader to update itself
    Term    int64
    // Success: true if follower contained entry matching PrevLogIndex and PrevLogTerm
    Success bool
}
```

On receipt:

1. If `Term` < `CurrentTerm`, return false.
2. If the log does not contain an entry with `PrevLogIndex` and `PrevLogTerm`, return false.
3. If a log entry at the new entry’s index conflicts (same index, different term), delete entry and all that follow it.
4. Append any new entries not already in the log.
5. If `LeaderCommit` > `CommitIndex`, set `CommitIndex` = min(`LeaderCommit`, index of last new entry).

#### RequestVote RPC

```go
type RequestVoteRequest struct {
    // Term: candidate's term
    Term         int64
    // CandidateId: candidate requesting vote
    CandidateId  int64
    // LastLogIndex: index of candidate's last log entry
    LastLogIndex int64
    // LastLogTerm: term of candidate's last log entry
    LastLogTerm  int64
}

type RequestVoteResponse struct {
    // Term: current term, for candidate to update itself
    Term        int64
    // VoteGranted: true means candidate received vote
    VoteGranted bool
}
```

On receipt:

1. If `Term` < `CurrentTerm`, return false.
2. If `VotedFor` is nil or CandidateId, and candidate's log is at least as up-to-date as receiver’s log, grant vote.

#### Server Rules

For all servers:

- If `CommitIndex` > `LastApplied`, increment `LastApplied` and apply `log[LastApplied]` to the state machine.
- If RPC request/response contains a term > `CurrentTerm`, set `CurrentTerm` to that term and revert to follower.

For followers:

- Respond to RPCs from candidates and leaders.
- If election timeout elapses without receiving AppendEntries from current leader or granting vote to a candidate, become a candidate.

For candidates:

- On becoming candidate, start election:
    - Increment current term.
    - Vote for self.
    - Reset election timer.
    - Send RequestVote RPCs to every other server.
- If votes received from a majority, become leader.
- If AppendEntries received from new leader, become follower.
- If election timeout elapses, start new election.

For leaders:

- Upon election, send initial empty AppendEntries RPCs (heartbeats) to each server; repeat during idle periods to prevent election timeouts.
- If command received from client: append entry to local log, respond after entry committed.
- If last log index ≥ nextIndex for a follower: send AppendEntries with log entries starting at nextIndex.
- If AppendEntries succeeds, update follower’s nextIndex/matchIndex.
- If AppendEntries fails due to inconsistency, decrement nextIndex and retry.
- If there exists an N > commitIndex such that a majority have matchIndex ≥ N and log[N].term == current term, set commitIndex = N.
---
title: 6.5840 Lab 2a — Leader Election
tags: ["raft","6.5840","6.824"]
lang: en
published: 2022-12-16T02:06:10+08:00
abbrlink: notes/65840/raftlab2a
description: "Lab 2a focuses on implementing the Leader Election and heartbeat mechanisms in the Raft algorithm, ensuring normal leadership transfers and elections even under extreme scenarios. This lab lays the foundation for the distributed KV store that will be implemented in later labs and is divided into four steps. By taking a lock-free approach, the complexity of the Raft struct is significantly reduced. The lab guide provides the necessary background, but unlike the previous lab, almost no reference code is provided—emphasizing independent implementation."
---
### Introduction

Lab 2 of MIT's 6.824 is about implementing the Raft consensus algorithm. In later labs, the distributed KV store will use this Raft implementation as its consensus module, so Lab 2 is absolutely crucial for everything that follows.

Lab 2 breaks down the entire Raft algorithm into four sub-labs, each focusing on a specific aspect. Lab 2a only requires implementing the basic Leader Election and heartbeat mechanisms to ensure normal leader rotation and election even under various adverse (partitioned) scenarios.

Of course, as the foundational lab, 2a isn’t just about getting Leader Election working—it's also about building out the core framework to handle the overall process. I implemented a lock-free version, which means you can toss out the `mu` variable from the Raft struct (cathartic, honestly).

### Lab Overview

The lab guide is available at [https://pdos.csail.mit.edu/6.824/labs/lab-raft.html](https://pdos.csail.mit.edu/6.824/labs/lab-raft.html). Unlike Lab 1, there’s almost no skeleton or reference code to depend on. You’ll implement your solution in `src/raft/raft.go`, starting from this barebones Raft struct:

```go
type Raft struct {
    peers []*labrpc.ClientEnd // RPC end points of all peers
    persister *Persister // Holds this peer's persisted state
    me int // this peer's index into peers[]
    dead int32 // set by Kill()
}
```

Each Raft instance represents a server in the cluster, and must store all the information that server needs.

- `peers` is a list of all servers in the cluster. The `ClientEnd` struct lets you send RPCs with a simple `Call` invocation.
- `me` is this server’s index—unique across the cluster.

The entry point is the `Make()` method. After initializing, it launches a goroutine running `rf.ticker()`. That routine functions as the main loop, repeatedly running (or, at least, running until shutdown, but for our intent, permanently) to drive the core logic.

What makes Lab 2 tough is that the skeleton is so minimal. We need to build most of Raft from scratch. Thankfully, Figure 2 in the Raft paper sketches out the essential logic and state transition flow.

Test cases live alongside your implementation in `test_test.go`. If a test fails, take a look there for clues about what’s being exercised. To run the 2a test suite, use: `go test -run 2A`. To check for race conditions as well: `go test -race -run 2A`.

### Implementation Strategy

#### Overall Flow

Since this is a lock-free implementation, the first step is to design the state machine and inter-goroutine communication carefully. Laying a solid foundation helps with future labs, and this one sets the entire framework.

Let’s standardize that only the "main goroutine" (`rf.ticker()`) can modify fields on the Raft struct. All other goroutines must not mutate shared state. This eliminates data races by construction. That means the `ticker()` method should be an infinite loop listening on several channels for events.

So what goroutines need communication? And, concretely, what channels? For Leader Election there are two RPCs: AppendEntries and RequestVote. When this server *receives* these via RPC, it’s not the main loop that handles the RPC directly, so their handlers need to *hand off* requests to the main loop by sending on a channel—one for each kind of request. Similarly, when outgoing requests (e.g., votes or heartbeats) get RPC responses, those must be handed back to the main goroutine for processing, requiring two more channels for the results.

Additionally, we need two timers—one for election timeout and the other for heartbeat intervals. The lab suggests simply using `time.Sleep()`, but that’s hard to interrupt/reset. So, in true rebel fashion, I used `time.Timer` for interruptible timers—even though the lab guide isn’t a fan of them. But, honestly, getting timers right is trickier than it looks.

We also need to define the server’s role ("status"):

```go
type ServerStatus uint8

const (
    Follower  ServerStatus = 0
    Candidate ServerStatus = 1
    Leader    ServerStatus = 2
)
```

Following Raft Figure 2, here’s how I flesh out the core state and set up channels/timers in `Raft`:

```go
type Raft struct {
    // ...other fields...

    // Status - current role
    Status ServerStatus
    // Channel to expose committed log entries to the KV store
    ApplyCh chan ApplyMsg

    /***** Persistent state on all servers *****/
    CurrentTerm int     // Latest term server has seen (initialized to 0, increases monotonically)
    VotedFor   int      // CandidateId that received vote in current term (or -1 for none)
    Logs       []*LogEntry

    /***** Volatile state on all servers *****/
    CommitIndex uint64
    LastApplied uint64

    /***** Volatile state on leaders *****/
    NextIndex  []uint64
    MatchIndex []uint64

    // Timers
    electionTimer  *time.Timer
    heartbeatTimer *time.Timer

    // RPC processing channels
    requestVoteChan       chan RequestVoteMsg
    appendEntriesChan     chan AppendEntriesMsg
    requestVoteResChan    chan RequestVoteResMsg
    appendEntriesResChan  chan AppendEntriesResMsg
}
```

All these channels and timers must be initialized in the `Make()` function, or you'll hit deadlocks on nil channels. The ticker goroutine is started in `Make()` as well:

```go
func (rf *Raft) ticker() {
    for !rf.killed() {
        select {
        case <-rf.electionTimer.C:
            rf.startElection()
            resetTimer(rf.electionTimer, RandomizedElectionTimeout())
        case <-rf.heartbeatTimer.C:
            rf.broadcastHeartbeat()
            resetTimer(rf.heartbeatTimer, FixedHeartbeatTimeout())
        case msg := <-rf.requestVoteChan:
            rf.handleRequestVote(msg)
        case msg := <-rf.appendEntriesChan:
            rf.handleAppendEntries(msg)
        case msg := <-rf.requestVoteResChan:
            rf.handleRequestVoteRes(msg)
        case msg := <-rf.appendEntriesResChan:
            rf.handleAppendEntriesRes(msg)
        }
    }
}
```

#### Two Timers

- **electionTimer** is initialized to a random value (300–450ms) to avoid split-vote storms on startup—no synchronized elections.
- **heartbeatTimer** is fixed at 100ms.

```go
func Make(peers []*labrpc.ClientEnd, me int, persister *Persister, applyCh chan ApplyMsg) *Raft {
    ...
    rf.electionTimer = time.NewTimer(RandomizedElectionTimeout())
    rf.heartbeatTimer = time.NewTimer(FixedHeartbeatTimeout())
    ...
}

func RandomizedElectionTimeout() time.Duration {
    rand.Seed(time.Now().UnixNano())
    return time.Duration(rand.Intn(150)+300) * time.Millisecond
}

func FixedHeartbeatTimeout() time.Duration {
    return time.Millisecond * 100
}
```

For followers and candidates, the election timer resets every time they hear from a valid leader. If the election timer expires, they start an election:

1. Increment current term.
2. Transition to candidate; vote for self.
3. Send RequestVote RPCs to all other servers.

Example:

```go
func (rf *Raft) startElection() {
    if rf.Status == Leader {
        return
    }
    rf.CurrentTerm += 1
    rf.Status = Candidate
    rf.VotedFor = rf.me
    args := RequestVoteArgs{
        Term:         rf.CurrentTerm,
        CandidateId:  rf.me,
        LastLogIndex: len(rf.Logs) - 1,
    }
    if len(rf.Logs) != 0 {
        args.LastLogTerm = rf.Logs[len(rf.Logs)-1].Term
    }
    meta := ElectionMeta{
        term: rf.CurrentTerm,
        yeas: 1,
        nays: 0,
    }
    for peer := range rf.peers {
        if peer == rf.me {
            continue
        }
        go rf.sendRequestVoteRoutine(peer, args, &meta)
    }
}
```

The ElectionMeta holds temporary state for the election—number of yes/no votes and term. You can’t block the main routine for responses, so you launch a goroutine for each peer. Once a result is in, that goroutine notifies the main loop via a channel. After starting an election, be sure to reset the election timer.

The **heartbeat timer** is used by leaders to maintain their role. When it expires, the leader should immediately broadcast heartbeats to prevent new elections. After broadcasting, reset the timer:

```go
func (rf *Raft) broadcastHeartbeat() {
    if rf.Status != Leader {
        return
    }
    args := AppendEntriesArgs{
        Term:     rf.CurrentTerm,
        LeaderID: rf.me,
    }
    for peer := range rf.peers {
        if peer == rf.me {
            continue
        }
        go rf.sendAppendEntriesRoutine(peer, args)
    }
}
```

Heartbeats are a degenerate (empty) AppendEntries RPC. Each peer gets an independent goroutine for this RPC.

#### RequestVote (Vote Solicitation)

On election timeout, a non-leader server starts an election (see above). In `startElection()`, each peer gets a goroutine managing its RequestVote RPC:

```go
func (rf *Raft) sendRequestVoteRoutine(peer int, args RequestVoteArgs, electionMeta *ElectionMeta) {
    reply := RequestVoteReply{}
    ok := rf.sendRequestVote(peer, &args, &reply)
    if !ok {
        return
    }
    msg := RequestVoteResMsg{
        resp: &reply,
        meta: electionMeta,
    }
    rf.requestVoteResChan <- msg
}
```

No special handling—just send the RPC and report its outcome via the response channel. The RequestVote args and reply look like this:

```go
type RequestVoteArgs struct {
    Term         int
    CandidateId  int
    LastLogIndex int
    LastLogTerm  int64
}

type RequestVoteReply struct {
    Term        int
    VoteGranted bool
}

// Send the RPC over the network:
func (rf *Raft) sendRequestVote(server int, args *RequestVoteArgs, reply *RequestVoteReply) bool {
    return rf.peers[server].Call("Raft.RequestVote", args, reply)
}
```

On the receiving side, the actual RPC handler hands off to the main loop for processing:

```go
func (rf *Raft) RequestVote(args *RequestVoteArgs, reply *RequestVoteReply) {
    msg := RequestVoteMsg{
        req: args,
        ok:  make(chan RequestVoteReply),
    }
    rf.requestVoteChan <- msg
    resp := <-msg.ok
    *reply = resp
}

func (rf *Raft) handleRequestVote(msg RequestVoteMsg) {
    req := msg.req
    if req.Term < rf.CurrentTerm ||
        (req.Term == rf.CurrentTerm && rf.VotedFor != -1 && rf.VotedFor != req.CandidateId) {
        msg.ok <- RequestVoteReply{
            Term:        rf.CurrentTerm,
            VoteGranted: false,
        }
        return
    }
    rf.rpcTermCheck(req.Term)
    rf.VotedFor = req.CandidateId
    resetTimer(rf.electionTimer, RandomizedElectionTimeout())
    msg.ok <- RequestVoteReply{
        Term:        rf.CurrentTerm,
        VoteGranted: true,
    }
}
```

If the server grants its vote, it resets the election timer. Raft’s term checks—`rpcTermCheck`—look like this:

```go
func (rf *Raft) rpcTermCheck(msgTerm int) {
    if rf.CurrentTerm < msgTerm {
        rf.CurrentTerm = msgTerm
        rf.Status = Follower
        rf.VotedFor = -1
    }
}
```

When the RequestVote RPC returns, its goroutine reports the outcome via the response channel; the main loop tallies votes:

```go
func (rf *Raft) handleRequestVoteRes(msg RequestVoteResMsg) {
    meta := msg.meta
    if rf.Status != Candidate {
        return
    }
    if rf.CurrentTerm != meta.term {
        return
    }
    if msg.resp.VoteGranted {
        meta.yeas++
        if meta.yeas > len(rf.peers)/2 {
            rf.Status = Leader
            resetTimer(rf.heartbeatTimer, FixedHeartbeatTimeout())
            rf.broadcastHeartbeat()
        }
    } else {
        meta.nays++
        rf.rpcTermCheck(msg.resp.Term)
        if meta.nays > len(rf.peers)/2 {
            // Election lost—reset our vote, permit voting for a new candidate
            rf.VotedFor = -1
        }
    }
}
```

If the current server is no longer a Candidate (maybe a new term arrived), or terms no longer match, just ignore this vote—it's stale.

If enough yes-votes accumulate (a majority), this server becomes Leader, resets the heartbeat timer, and broadcasts an immediate heartbeat to declare itself. If enough no-votes accumulate, you can optimistically clear your VotedFor early so the next election starts promptly.

#### AppendEntries (Heartbeats)

This lab only requires heartbeat (empty) AppendEntries—log replication will be part of later labs! When `broadcastHeartbeat()` triggers above, each peer gets a goroutine for the RPC:

```go
func (rf *Raft) sendAppendEntriesRoutine(peer int, args AppendEntriesArgs) {
    reply := AppendEntriesReply{}
    ok := rf.sendAppendEntries(peer, &args, &reply)
    if !ok {
        return
    }
    rf.appendEntriesResChan <- AppendEntriesResMsg{
        resp: &reply,
    }
}
```

As with voting, just send the RPC and push responses to the main loop. Here are the arguments:

```go
type AppendEntriesArgs struct {
    Term         int
    LeaderID     int
    PrevLogIndex int
    PrevLogTerm  int
    Entries      []*LogEntry
    LeaderCommit int
}

type AppendEntriesReply struct {
    Term    int
    Success bool
}

func (rf *Raft) sendAppendEntries(server int, args *AppendEntriesArgs, reply *AppendEntriesReply) bool {
    return rf.peers[server].Call("Raft.AppendEntries", args, reply)
}
```

The receiving side hands the request off to the main loop, which processes only heartbeats for now:

```go
func (rf *Raft) AppendEntries(args *AppendEntriesArgs, reply *AppendEntriesReply) {
    msg := AppendEntriesMsg{
        req: args,
        ok:  make(chan AppendEntriesReply),
    }
    rf.appendEntriesChan <- msg
    resp := <-msg.ok
    *reply = resp
}

func (rf *Raft) handleAppendEntries(msg AppendEntriesMsg) {
    rf.Status = Follower
    resetTimer(rf.electionTimer, RandomizedElectionTimeout())
    rf.rpcTermCheck(msg.req.Term)
    msg.ok <- AppendEntriesReply{
        Term: rf.CurrentTerm,
    }
}
```

Finally, when the response comes back to the sender, just use `rpcTermCheck` again:

```go
func (rf *Raft) handleAppendEntriesRes(msg AppendEntriesResMsg) {
    resp := msg.resp
    rf.rpcTermCheck(resp.Term)
}
```
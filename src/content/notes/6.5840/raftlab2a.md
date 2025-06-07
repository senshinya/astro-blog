---
title: 6.5840 实验 2a —— Leader 选举
tags: ["raft","6.5840","6.824"]
lang: zh
published: 2022-12-16T02:06:10+08:00
description: "实验 2a 专注于实现 Raft 算法中的 Leader 选举和心跳机制，旨在确保在各种极端情况下的正常换届和选举。这一实验是后续分布式KV存储实现的基础，包含了四个步骤，通过无锁版本的设计简化了 Raft 结构体的复杂性。实验指导书提供了必要的背景资料，但与前一实验相比，本次几乎不依赖参考资料，强调了独立实现的重要性。"
---
### 前言

6.824 的实验二，是实现 Raft 算法，在后续实验中的实现的分布式 KV 存储会将本实验实现的 Raft 算法作为分布式共识模块使用，所以实验二对后续实验至关重要。

实验二将整个 Raft 算法分为四个步骤，作为四个子实验去实现。实验 2a 只实现基本的 Leader 选举和心跳，来保证在各种极端（断线）场景下都可以正常地换届和选举。

Of course，2a 作为奠定整个四个子实验基础的起始实验，不仅仅需要实现 Leader 选举功能，更需要搭好整体的流程处理的框架。同样，我实现的是无锁版本，Raft 结构体里的 mu 变量可以删掉啦（癫狂

### 实验讲解

实验指导书在 [https://pdos.csail.mit.edu/6.824/labs/lab-raft.html](https://pdos.csail.mit.edu/6.824/labs/lab-raft.html)。和实验一不一样，这次几乎没有任何参考。我们需要实现的代码在 `src/raft/raft.go` 中，这个 Raft 结构体只有一个很基础的结构体：

```go
type Raft struct {
    peers []*labrpc.ClientEnd // RPC end points of all peers
    persister *Persister // Object to hold this peer's persisted state
    me int // this peer's index into peers[]
    dead int32 // set by Kill()
}
```

每一个 Raft 结构体都是集群中的一个 Server，Raft 结构体需要存储该 Server 所有需要的内容。

其中 peers 是当前配置集群的所有 server，ClientEnd 结构体可以通过调用 Call 直接发送 RPC 请求，me 则是当前机器在集群中的唯一标识，再其他机器上也是认这个 index 的。

lab2a 中 Raft 的入口是 `Make()` 方法，在 Make 方法初始化完成结构体后，会启动一个协程 `rf.ticker()`，该协程会执行一个无限循环（其实是根据结束标识持续执行的循环，鉴于我们不关心机器被关闭后的事情，所以可以看作无限循环），这个方法可以看作主协程。

实验二最难的地方就在于，框架实现的内容太少了，我们基本需要从零实现整个 Raft 算法。好在，论文中的 Figure 2 基本已经给出了整体的实现思路。

另外，测试用例的实现在同文件夹下的 `test_test.go` 中，如果测试用例不通过，可以看一下测试用例的实现，根据测试场景来 debug。

lab 2d 的测试命令为 `go test -run 2A`，建议使用 `go test -race -run 2A` 来同时检测数据竞争。

### 实验思路

#### 整体流程

由于实现无锁版本，首先就需要仔细规划整体的处理流程和协程间通信，打好一个良好的基础，对后续实验也有很大的帮助，毕竟是一系列实验中的第一个。

首先约定主协程就是 `rf.ticker()` 方法，只有这个方法可以修改 Raft 结构体中的字段，其他协程都不允许，这样就直接避免了数据竞争，所以 `ticker()` 方法中应当是无限循环监听一堆 channel 的消息。

那么具体有哪些协程需要通信，需要哪些管道呢？首先，选举一共涉及两种 RPC 请求：追加请求和拉票请求，当服务器作为这两种请求的接收端时，一定不是首先在主协程中接收 RPC 请求的，那么这两种 RPC 请求需要发给主协程处理，就需要两个管道；其次，如果机器作为发送端，发送请求一般是由非主协程操作的（不能让主协程等待 RPC 返回），那么在这两种 RPC 获取到响应时，需要提交给主协程处理，就又需要两个管道。

除此以外，还需要两个定时器，分别用于选举超时和心跳超时。实验指导中推荐是使用 `time.Sleep()`，通过睡一段时间来实现定时。但是这种方式没有办法实现倒计时打断，所以，虽然指导书中不推荐 `time.Timer`，但是叛逆为了实现倒计时打断重置，我还是使用了 Timer。不过，timer 用对真的挺不容易。

首先需要定义 Server 的状态，来标识 Server 的身份：

```go
type ServerStatus uint8
 
const (
    Follower  ServerStatus = 0
    Candidate ServerStatus = 1
    Leader    ServerStatus = 2
)
```

对照 Raft 论文 Figure 2，定义一下 Server 的基础字段，并定义上面提到的几个管道和定时器：

```go
type Raft struct {
    ...

    // Status
    Status ServerStatus
    // 已提交日志，外部获取管道
    ApplyCh chan ApplyMsg

    /***** 所有 Server 都包含的持久状态 *****/
    // CurrentTerm 机器遇到的最大的任期，启动时初始化为 0，单调递增
    CurrentTerm int
    // VotedFor 当前任期内投票的 Candidate ID，未投票则为 -1
    VotedFor int
    // Logs 日志条目，每个条目都包含了一条状态机指令和 Leader 接收该条目时的任期，index 从 1 开始
    Logs []*LogEntry

    /***** 所有 Server 都包含的可变状态 *****/
    // CommitIndex 已知的最大的即将提交的日志索引，启动时初始化为 0，单调递增
    CommitIndex uint64
    // LastApplied 最大的已提交的日志索引，启动时初始化为 0，单调递增
    LastApplied uint64

    /******* Leader 包含的可变状态，选举后初始化 *******/
    // NextIndex 每台机器下一个要发送的日志条目的索引，初始化为 Leader 最后一个日志索引 +1
    NextIndex []uint64
    // MatchIndex 每台机器已知复制的最高的日志条目，初始化为 0，单调递增
    MatchIndex []uint64

    // 定时器
    electionTimer  *time.Timer
    heartbeatTimer *time.Timer

    // 处理 rpc 请求的管道
    requestVoteChan   chan RequestVoteMsg
    appendEntriesChan chan AppendEntriesMsg
}
```

注意用到的管道和定时器等，都需要在 `Make()` 函数中初始化，否则 nil 管道会阻塞所有的读写操作，并在函数返回前起一协程作为主协程，监听管道消息：

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

#### 两个定时器

electionTimer 是选举超时的定时器，每次需要初始化为一个随机时间，来防止启动时集群中的机器集体选举超时。这里随机时间范围为 300 ~ 450 ms。heartbeatTimer 是心跳超时的定时器，初始化为一个固定时间 100 ms。

```go
func Make(peers []*labrpc.ClientEnd, me int,
    persister *Persister, applyCh chan ApplyMsg) *Raft {
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

选举超时定时器主要用于非 Leader，每次收到 Leader 的心跳后，Server 会重置选举定时器，然而在一段时间没有收到 Server 的消息，Server 就会发起选举。发起选举流程如下：

1.  当前任期 +1
2.  身份变为 Candidate，同时投票给自己
3.  向所有机器发送拉票请求

实现如下：

```go
func (rf *Raft) startElection() {
    if rf.Status == Leader {
        // leader 无需发起新选举
        return
    }
    rf.CurrentTerm += 1
    // fmt.Printf("server %d start election for term %d\n", rf.me, rf.CurrentTerm)
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

构造了一个 ElectionMeta 来存储一次选举的元信息，包含这次选举的任期、投赞同和反对票的 Server 个数。由于不可能在主协程中等待各个机器投票完毕，便对集群中的每一台机器都开启了一个协程来管理拉票 RPC，这些 RPC 会在获知选举结果后通过管道通知主协程。另外在发起选举后，需要重置选举超时定时器。

心跳超时定时器主要用于 Leader，用来在集群中维系自己的 Leader 身份，每当心跳超时定时器超时，Leader 就会在集群中广播心跳，来保证不会有新的选举发起。同样，广播过后也需要重置心跳超时定时器。

```go
func (rf *Raft) broadcastHeartbeat() {
    if rf.Status != Leader {
        return
    }
    // fmt.Printf("server %d broadcast heartbeat\n", rf.me)
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

心跳 RPC 复用追加 RPC，同样，和集群中其他机器的 RPC 连接在单独的协程中处理。

#### 拉票相关

在选举定时器超时后，非 Leader 的机器就会发起新的选举，来尝试选出新的 Leader。在上面 `StartElection()` 中，已经为每个机器开启了一个协程，用来管理对每个机器的拉票 RPC。发送拉票请求的协程函数如下：

```go
// 发送拉票请求的协程
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

没有特殊的处理，仅仅是发送 RPC 请求，并将请求结果包装后通过管道发送给主协程处理。这里定义 RPC 的请求和响应参数结构：

```go
// 拉票 RPC 请求
type RequestVoteArgs struct {
    // Term Candidate 的任期
    Term int
    // CandidateId 拉票的 Candidate 的 ID
    CandidateId int
    // LastLogIndex Candidate 最后一条日志序列的索引
    LastLogIndex int
    // LastLogTerm Candidate 最后一条日志序列的任期
    LastLogTerm int64
}

// 拉票 RPC 响应
type RequestVoteReply struct {
    // Term 当前任期
    Term int
    // VoteGranted true 则拉票成功
    VoteGranted bool
}

// 拉票请求 RPC 发送入口
func (rf *Raft) sendRequestVote(server int, args *RequestVoteArgs, reply *RequestVoteReply) bool {
    ok := rf.peers[server].Call("Raft.RequestVote", args, reply)
    return ok
}
```

接收端的 RPC 入口是 RequestVote 方法，由于接收 RPC 请求的协程不是主协程，这里仍然需要使用管道将拉票请求传递给主协程处理

```go
/********* 拉票请求接收端相关方法 *********/
// 拉票请求 RPC 接收入口
func (rf *Raft) RequestVote(args *RequestVoteArgs, reply *RequestVoteReply) {
    msg := RequestVoteMsg{
        req: args,
        ok:  make(chan RequestVoteReply),
    }
    rf.requestVoteChan <- msg
    resp := <-msg.ok
    *reply = resp
}

// 主协程处理拉票请求
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
    // fmt.Printf("server %d vote for server %d for term %d\n", rf.me, msg.req.CandidateId, req.Term)
    msg.ok <- RequestVoteReply{
        Term:        rf.CurrentTerm,
        VoteGranted: true,
    }
}
```

如果 Server 投了赞成票，还需要重置选举超时定时器。`rpcTermCheck()` 是一个通用的，用于检查 rpc 请求或响应中的任期是否大于自身的任期，如果大于自身任期则需要更新任期并成为 Follower：

```go
// 检查 rpc 请求响应中的 term，如果大于自己的则需要更新任期并成为 Follower
func (rf *Raft) rpcTermCheck(msgTerm int) {
    if rf.CurrentTerm < msgTerm {
        rf.CurrentTerm = msgTerm
        rf.Status = Follower
        rf.VotedFor = -1
    }
}
```

在发起投票的协程获得了返回的投票结果后，将投票结果提交给主协程处理，在主协程中进行一些计票等判断。主协程处理投票结果如下

```go
// 主协程处理拉票请求返回结果
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
            // fmt.Printf("server %d become leader for term %d\n", rf.me, rf.CurrentTerm)
            rf.Status = Leader
            resetTimer(rf.heartbeatTimer, FixedHeartbeatTimeout())
            rf.broadcastHeartbeat()
        }
    } else {
        meta.nays++
        rf.rpcTermCheck(msg.resp.Term)
        if meta.nays > len(rf.peers)/2 {
            // 反对票超过一半，则该任期选举失败；可以给其他机器投票
            rf.VotedFor = -1
        }
    }
}
```

前置两个校验，如果当前 Server 的身份不是 Candidate，或者 Server 的任期和投票的任期不一致，就说明是一场过期的投票，无需处理，直接返回即可。

如果投的是赞成票，那么就计算一下当前赞成票数是否已大于一半，如果已经大于一半，说明选举成功，发起选举的 Server 转变为 Leader，并重置心跳定时器，向所有机器广播心跳来声明自己的 Leader 身份。

如果投的是反对票，这里算是个小优化。可以直接校验反对票是否已经超过一半，如果超过一半，那么可以认为该次发起的选举已经失败。可以将本任期内的投票置为 -1，以给其他潜在的 Candidate 投票来加速 Leader 选举。

#### 追加相关

追加相关的内容，本次实验只需要实现心跳的处理即可。更具体的追加在实验 2b 中。

在 `broadcastHeartbeat()` 函数中，对集群中的全部机器广播心跳，使用的就是追加请求。对于每个机器都有一协程来管理与之通信的追加请求。追加协程的函数如下

```go
// 发送追加请求的协程
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

与上面的发起选举类似，也是直接发送一个 RPC 请求，并等待响应，将响应通过管道交由主协程处理。追加 RPC 的请求与响应定义如下

```go
// 追加 RPC 请求
type AppendEntriesArgs struct {
    // Term Leader 的任期
    Term int
    // LeaderID Follower 可以将客户端请求重定向到 Leader
    LeaderID int
    // PrevLogIndex 新日志条目前一个日志条目的日志索引
    PrevLogIndex int
    // PrevLogTerm 前一个日志条目的任期
    PrevLogTerm int
    // Entries 需要保存的日志条目，心跳包为空
    Entries []*LogEntry
    // LeaderCommit Leader 的 CommitIndex
    LeaderCommit int
}

// 追加 RPC 响应
type AppendEntriesReply struct {
    // Term Follower 当前任期
    Term int
    // Success Follower 包含 PrevLogIndex 和 PrevLogTerm 的日志条目为 true
    Success bool
}

// 追加请求 RPC 发送入口
func (rf *Raft) sendAppendEntries(server int, args *AppendEntriesArgs, reply *AppendEntriesReply) bool {
    ok := rf.peers[server].Call("Raft.AppendEntries", args, reply)
    return ok
}
```

接收方在收到追加 RPC 请求后，将请求交由主协程处理，当前主协程也只需要处理心跳场景，即转变为 Follower，重置选举超时定时器，并判断是否需要更新任期：

```go
/********* 追加请求接收端相关方法 *********/
// 追加请求 RPC 接收入口
func (rf *Raft) AppendEntries(args *AppendEntriesArgs, reply *AppendEntriesReply) {
    msg := AppendEntriesMsg{
        req: args,
        ok:  make(chan AppendEntriesReply),
    }
    rf.appendEntriesChan <- msg
    resp := <-msg.ok
    *reply = resp
}

// 主协程处理追加请求
func (rf *Raft) handleAppendEntries(msg AppendEntriesMsg) {
    rf.Status = Follower
    resetTimer(rf.electionTimer, RandomizedElectionTimeout())
    rf.rpcTermCheck(msg.req.Term)
    msg.ok <- AppendEntriesReply{
        Term: rf.CurrentTerm,
    }
}
```

最后发送端处理响应，只需要检查任期即可，仍可复用 `rpcTermCheck()`：

```go
// 主协程处理追加请求返回结果
func (rf *Raft) handleAppendEntriesRes(msg AppendEntriesResMsg) {
    resp := msg.resp
    rf.rpcTermCheck(resp.Term)
}
```
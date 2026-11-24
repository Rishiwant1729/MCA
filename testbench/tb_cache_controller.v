// Self-checking testbench for the direct-mapped cache controller (milestone 1, read-only).
//
// Checking strategy (two independent layers):
//   1. A monitor watches the CPU interface on every clock. At each accepted
//      request it computes the expected result from (a) reference_memory for
//      data and (b) a behavioral cache model in this file (valid/tag arrays)
//      for hit/miss. It checks every response, plus protocol rules (one
//      response per request, none spurious, none before memory data arrives).
//   2. Directed tests add their own explicit expectations (hit/miss pattern,
//      latency, memory transaction count, internal valid/tag/data contents).
//
// Parameters:  LAT = memory latency, SEED = random seed, NRAND = random requests.
// Exit: prints "SUMMARY: PASS" or "SUMMARY: FAIL" and calls $fatal(1) on failure.
`timescale 1ns/1ps
module tb_cache_controller;
    parameter LAT   = 4;
    parameter SEED  = 1;
    parameter NRAND = 5000;
    parameter ACCEPT_DELAY = 0;       // memory back-pressure: cycles mem_req_ready is held low (0 = none)

    localparam MEM_BYTES = 65536;
    localparam HIT_LAT   = 2;          // measured in Phase 4: accept edge -> resp edge
    localparam MISS_LAT  = LAT + 7 + ACCEPT_DELAY;
    localparam WAIT_PER_MISS = LAT + 4 + ACCEPT_DELAY;

    // ------------------------------------------------------------ DUT + models
    reg clk = 0, rst_n = 0;
    always #5 clk = ~clk;
    reg [31:0] cyc = 0;  always @(posedge clk) cyc <= cyc + 1;

    reg         req_valid = 0, drv_we = 0;
    reg  [31:0] req_addr  = 0;
    wire        req_ready, resp_valid, resp_err, resp_hit;
    wire [31:0] resp_rdata;
    wire        mreq_v, mreq_r, mresp_v;
    wire [31:0] mreq_a;
    wire [127:0] mresp_d;
    wire [31:0] s_req, s_hit, s_miss, s_mrd, s_cmp, s_cyc, s_wait;

    cache_controller #(.MEM_BYTES(MEM_BYTES)) dut (.clk(clk), .rst_n(rst_n),
        .req_valid(req_valid), .req_ready(req_ready), .req_addr(req_addr),
        .req_we(drv_we), .req_wdata(32'd0), .req_be(4'd0),
        .resp_valid(resp_valid), .resp_rdata(resp_rdata), .resp_err(resp_err), .resp_hit(resp_hit),
        .mem_req_valid(mreq_v), .mem_req_ready(mreq_r), .mem_req_addr(mreq_a),
        .mem_resp_valid(mresp_v), .mem_resp_data(mresp_d),
        .stat_requests(s_req), .stat_hits(s_hit), .stat_misses(s_miss),
        .stat_mem_reads(s_mrd), .stat_completed(s_cmp), .stat_cycles(s_cyc),
        .stat_mem_wait_cycles(s_wait));

    main_memory_model #(.MEM_BYTES(MEM_BYTES), .LATENCY(LAT), .ACCEPT_DELAY(ACCEPT_DELAY)) mem (.clk(clk), .rst_n(rst_n),
        .mem_req_valid(mreq_v), .mem_req_ready(mreq_r), .mem_req_addr(mreq_a),
        .mem_resp_valid(mresp_v), .mem_resp_data(mresp_d));

    wire [31:0] mon_ref_data;                       // reference word at req_addr (monitor)
    reference_memory #(.MEM_BYTES(MEM_BYTES)) mon_ref (.addr(req_addr), .rdata(mon_ref_data));
    reg  [31:0] tref_addr = 0;  wire [31:0] tref_data;   // reference word (directed checks)
    reference_memory #(.MEM_BYTES(MEM_BYTES)) tst_ref (.addr(tref_addr), .rdata(tref_data));

    // white-box view of one data-RAM line (assembled from the byte lanes)
    reg [5:0] peek_idx = 0;
    wire [127:0] peek_line;
    genvar pg;
    generate for (pg = 0; pg < 16; pg = pg + 1) begin : peek
        assign peek_line[8*pg +: 8] = dut.u_data.lane[pg].mem[peek_idx];
    end endgenerate

    // ------------------------------------------------------------ test bookkeeping
    integer test_no = 0, test_fail = 0, test_checks = 0;
    integer n_tests = 0, n_failed = 0;
    reg [8*28-1:0] res_name [1:12];
    reg            res_pass [1:12];
    reg [8*28-1:0] cur_name;

    task fail(input [8*56-1:0] msg);
        begin
            test_fail = test_fail + 1;
            $display("    FAIL[T%0d @%0t] %0s  (addr=%h)", test_no, $time, msg, req_addr);
        end
    endtask
    task chk(input cond, input [8*56-1:0] msg);
        begin test_checks = test_checks + 1; if (!cond) fail(msg); end
    endtask
    task chk_eq(input [63:0] actual, input [63:0] expected, input [8*40-1:0] msg);
        begin
            test_checks = test_checks + 1;
            if (actual !== expected) begin
                test_fail = test_fail + 1;
                $display("    FAIL[T%0d @%0t] %0s: actual=%0d expected=%0d", test_no, $time, msg, actual, expected);
            end
        end
    endtask

    // ------------------------------------------------------------ behavioral cache model + monitor
    reg         m_valid [0:63];
    reg  [21:0] m_tag   [0:63];
    integer m_req, m_hit, m_miss, m_bad, m_done, mem_reqs, stall_cycles;
    reg        out_busy;
    reg        e_bad, e_hit, mresp_seen;
    reg [31:0] e_data, last_mem_addr;
    integer    mi, midx;  reg [21:0] mtg;

    always @(posedge clk) begin
        if (!rst_n) begin
            for (mi = 0; mi < 64; mi = mi + 1) m_valid[mi] = 1'b0;
            m_req = 0; m_hit = 0; m_miss = 0; m_bad = 0; m_done = 0; mem_reqs = 0;
            out_busy = 0; mresp_seen = 0;
        end else begin
            // --- response checks (state before this edge's accept) ---
            if (resp_valid) begin
                if (!out_busy) fail("spurious or duplicate resp_valid");
                else begin
                    if (resp_err !== e_bad) fail("resp_err wrong");
                    else if (e_bad) begin
                        if (resp_rdata !== 32'd0) fail("error response data must be 0");
                    end else begin
                        if (resp_rdata !== e_data) begin
                            test_fail = test_fail + 1;
                            $display("    FAIL[T%0d @%0t] data mismatch: got %h expected %h (addr=%h)",
                                     test_no, $time, resp_rdata, e_data, req_addr);
                        end
                        if (resp_hit !== e_hit) fail("resp_hit differs from cache model");
                        if (!e_hit && !mresp_seen) fail("miss response before memory data");
                    end
                    out_busy = 0; m_done = m_done + 1;
                end
            end
            // --- request accepted ---
            if (req_valid && req_ready) begin
                if (out_busy) fail("request accepted while one is outstanding");
                e_bad = (req_addr[1:0] != 2'b00) || (req_addr >= MEM_BYTES) || drv_we;
                m_req = m_req + 1;
                if (e_bad) m_bad = m_bad + 1;
                else begin
                    midx = req_addr[9:4]; mtg = req_addr[31:10];
                    e_hit  = m_valid[midx] && (m_tag[midx] == mtg);
                    e_data = mon_ref_data;
                    if (e_hit) m_hit = m_hit + 1;
                    else begin m_miss = m_miss + 1; m_valid[midx] = 1'b1; m_tag[midx] = mtg; end
                end
                out_busy = 1; mresp_seen = 0;
            end
            if (req_valid && !req_ready) stall_cycles = stall_cycles + 1;
            if (mresp_v) mresp_seen = 1;
            if (mreq_v && mreq_r) begin mem_reqs = mem_reqs + 1; last_mem_addr = mreq_a; end
        end
    end
    initial stall_cycles = 0;

    // ------------------------------------------------------------ memory-side protocol checker
    // Rules checked on every clock while out of reset:
    //   P1 mem_req_valid, once raised, stays high with a stable address until mem_req_ready accepts it
    //   P2 the request address is block aligned
    //   P3 no new request is accepted while a read is still outstanding (no duplicate transactions)
    //   P4 mem_resp_valid only occurs while a read is outstanding, and is a single-cycle pulse
    //   P5 no more than one memory read per cache miss (checked per test through stat_mem_reads == misses)
    reg        pc_pend = 0, pc_outst = 0, pc_resp_prev = 0;
    reg [31:0] pc_addr;
    always @(posedge clk) begin
        if (!rst_n) begin pc_pend <= 0; pc_outst <= 0; pc_resp_prev <= 0; end
        else begin
            if (pc_pend && !mreq_v) fail("P1 mem_req_valid dropped before ready");
            if (pc_pend && mreq_v && mreq_a !== pc_addr) fail("P1 mem_req_addr changed while pending");
            if (mreq_v && mreq_a[3:0] !== 4'd0) fail("P2 mem_req_addr not block aligned");
            if (mreq_v && mreq_r && pc_outst) fail("P3 request accepted with a read outstanding");
            if (mresp_v && !pc_outst) fail("P4 mem_resp_valid without outstanding read");
            if (mresp_v && pc_resp_prev) fail("P4 mem_resp_valid held for more than one cycle");
            pc_resp_prev <= mresp_v;
            pc_pend <= mreq_v && !mreq_r; pc_addr <= mreq_a;
            if (mresp_v) pc_outst <= 0;
            if (mreq_v && mreq_r) pc_outst <= 1;
        end
    end

    // ------------------------------------------------------------ driver helpers
    task do_reset;
        begin
            @(negedge clk); rst_n = 0; req_valid = 0; drv_we = 0;
            repeat (3) @(negedge clk);
            rst_n = 1; @(negedge clk);
        end
    endtask

    reg [31:0] got; reg got_hit, got_err; integer lat, acc_cyc, tmo;
    task start_req(input [31:0] a);        // returns right after the accept edge
        begin
            @(negedge clk); req_valid = 1; req_addr = a;
            @(posedge clk); while (!req_ready) @(posedge clk);
            acc_cyc = cyc; #1 req_valid = 0;
            req_addr = a ^ 32'h0000_05A0;   // CPU moves on: controller must use its latched copy
        end
    endtask
    task wait_resp;
        begin
            tmo = 0;
            @(posedge clk);
            while (!resp_valid && tmo < 2000) begin @(posedge clk); tmo = tmo + 1; end
            if (tmo >= 2000) fail("timeout waiting for resp_valid");
            got = resp_rdata; got_hit = resp_hit; got_err = resp_err; lat = cyc - acc_cyc;
        end
    endtask
    task access_any(input [31:0] a);       // read + latency self-consistency check
        begin
            start_req(a); wait_resp;
            if (got_err) chk(lat == 1, "error response latency");
            else if (got_hit) chk(lat == HIT_LAT, "hit latency");
            else chk(lat == MISS_LAT, "miss latency");
        end
    endtask
    task access(input [31:0] a, input exp_hit);
        begin
            access_any(a);
            chk(got_err === 1'b0, "unexpected error");
            if (got_hit !== exp_hit) begin
                test_fail = test_fail + 1;
                $display("    FAIL[T%0d @%0t] addr=%h expected %0s, got %0s", test_no, $time, a,
                         exp_hit ? "HIT" : "MISS", got_hit ? "HIT" : "MISS");
            end
            test_checks = test_checks + 1;
        end
    endtask
    task access_err(input [31:0] a, input we);
        begin
            drv_we = we; access_any(a); drv_we = 0;
            chk(got_err === 1'b1, "expected resp_err=1");
            chk(got === 32'd0, "error data must be zero");
        end
    endtask

    task check_stats;                      // call only when the controller is idle
        begin
            repeat (2) @(negedge clk);
            chk_eq(s_req,  m_req,  "stat_requests");
            chk_eq(s_hit,  m_hit,  "stat_hits");
            chk_eq(s_miss, m_miss, "stat_misses");
            chk_eq(s_mrd,  m_miss, "stat_mem_reads == misses");
            chk_eq(s_mrd,  mem_reqs, "stat_mem_reads == mem bus reads");
            chk_eq(s_cmp,  m_done, "stat_completed");
            chk_eq(s_wait, m_miss * WAIT_PER_MISS, "stat_mem_wait_cycles");
            chk_eq(s_req,  s_cmp, "requests == completed");
        end
    endtask

    task get_block(input [31:0] base, output [127:0] b);
        begin
            tref_addr = base;      #1 b[31:0]   = tref_data;
            tref_addr = base + 4;  #1 b[63:32]  = tref_data;
            tref_addr = base + 8;  #1 b[95:64]  = tref_data;
            tref_addr = base + 12; #1 b[127:96] = tref_data;
        end
    endtask

    task begin_test(input integer n, input [8*28-1:0] name, input [8*120-1:0] expected);
        begin
            test_no = n; test_fail = 0; test_checks = 0; cur_name = name;
            $display("[T%0d] %0s", n, name);
            $display("      expected: %0s", expected);
            do_reset;
        end
    endtask
    task end_test;
        begin
            check_stats;
            $display("      actual  : checks=%0d failures=%0d | requests=%0d hits=%0d misses=%0d mem_reads=%0d (LAT=%0d)",
                     test_checks, test_fail, s_req, s_hit, s_miss, s_mrd, LAT);
            res_name[test_no] = cur_name; res_pass[test_no] = (test_fail == 0);
            n_tests = n_tests + 1;
            if (test_fail != 0) n_failed = n_failed + 1;
            $display("      result  : %0s", test_fail == 0 ? "PASS" : "FAIL");
        end
    endtask

    // ------------------------------------------------------------ tests
    integer i, j, k, r0, n, gap, kind;
    reg [31:0] a, rnd, seed;
    reg [127:0] blk;
    reg [31:0] stream [0:39];
    integer ready_low_seen;
    integer sel;
    reg [8*256-1:0] vcd_path;

    initial begin
        // +test=N runs only test N (default: all). +vcd=<file> or +dump selects waveform output;
        // +fulldump keeps dumping through test 10 (otherwise a full-suite dump stops there to bound the file size).
        sel = 0;  if ($value$plusargs("test=%d", sel)) ;
        if ($value$plusargs("vcd=%s", vcd_path)) begin
            $dumpfile(vcd_path);
            $dumpvars(0, tb_cache_controller);
        end else if ($test$plusargs("dump")) begin
            $dumpfile($sformatf("results/waveforms/tb_cache_lat%0d.vcd", LAT));
            $dumpvars(0, tb_cache_controller);
        end
        seed = SEED;
        $display("=== Direct-mapped cache controller testbench: LAT=%0d SEED=%0d NRAND=%0d ===", LAT, SEED, NRAND);

        // ---- T1 cold miss
        if (sel == 0 || sel == 1) begin
        begin_test(1, "cold_miss",
            "invalid line -> miss; 1 block-aligned memory read; line installed (valid/tag/data); correct data");
        chk(dut.u_valid.valid === 64'd0, "valid bits not all 0 after reset");
        a = 32'h0000_0044;                               // index 4, offset 4
        r0 = mem_reqs;
        access(a, 0);
        chk_eq(mem_reqs - r0, 1, "memory reads for cold miss");
        chk_eq(last_mem_addr, 32'h40, "memory read must be block aligned");
        chk(dut.u_valid.valid[4] === 1'b1, "valid bit not set");
        chk(dut.u_tag.mem[4] === 22'd0, "tag not installed");
        get_block(32'h40, blk);
        peek_idx = 4; #1;
        chk(peek_line === blk, "data line differs from memory block");
        end_test;
        end

        // ---- T2 repeated access
        if (sel == 0 || sel == 2) begin
        begin_test(2, "repeated_access", "first access misses, second hits; only 1 memory read");
        r0 = mem_reqs;
        access(32'h0000_0080, 0);
        access(32'h0000_0080, 1);
        access(32'h0000_0080, 1);
        chk_eq(mem_reqs - r0, 1, "memory reads");
        end_test;
        end

        // ---- T3 same-block accesses
        if (sel == 0 || sel == 3) begin
        begin_test(3, "same_block_accesses", "4 words of one block: 1 miss then 3 hits, no extra refill");
        r0 = mem_reqs;
        access(32'h0000_0108, 0);
        access(32'h0000_0100, 1);
        access(32'h0000_0104, 1);
        access(32'h0000_010C, 1);
        chk_eq(mem_reqs - r0, 1, "memory reads for one block");
        end_test;
        end

        // ---- T4 direct-mapped conflict
        if (sel == 0 || sel == 4) begin
        begin_test(4, "direct_mapped_conflict", "0 and 1024 share index, differ in tag; alternating -> every access misses");
        chk(((32'h0000_0000 >> 4) & 63) == ((32'h0000_0400 >> 4) & 63), "index must match");
        chk((32'h0000_0000 >> 10) != (32'h0000_0400 >> 10), "tags must differ");
        r0 = mem_reqs;
        for (i = 0; i < 3; i = i + 1) begin
            access(32'h0000_0000, 0);
            chk(dut.u_tag.mem[0] === 22'd0, "line 0 should hold tag 0");
            access(32'h0000_0400, 0);
            chk(dut.u_tag.mem[0] === 22'd1, "line 0 should hold tag 1");
        end
        chk_eq(mem_reqs - r0, 6, "memory reads (all conflict misses)");
        chk_eq(m_hit, 0, "no hits expected");
        end_test;
        end

        // ---- T5 different cache lines
        if (sel == 0 || sel == 5) begin
        begin_test(5, "different_cache_lines", "64 blocks, one per line: 64 misses, then 64 hits (no mutual eviction)");
        for (i = 0; i < 64; i = i + 1) access(i * 16, 0);
        for (i = 0; i < 64; i = i + 1) access(i * 16 + 8, 1);
        chk_eq(mem_reqs, 64, "memory reads");
        access(32'h0000_0030, 1);
        access(32'h0000_0050, 1);
        end_test;
        end

        // ---- T6 sequential access
        if (sel == 0 || sel == 6) begin
        begin_test(6, "sequential_access", "256 sequential words: 1 miss per 4-word block (64 miss/192 hit); 2nd pass all hit");
        for (a = 0; a < 1024; a = a + 4) access(a, (a % 16) != 0);
        chk_eq(m_miss, 64, "misses after first pass");
        chk_eq(m_hit, 192, "hits after first pass");
        for (a = 0; a < 1024; a = a + 4) access(a, 1);
        chk_eq(m_hit, 192 + 256, "hits after second pass");
        end_test;
        end

        // ---- T7 reset
        if (sel == 0 || sel == 7) begin
        begin_test(7, "reset", "reset clears valid bits and counters; stale tag/data never hit; reset mid-miss is clean");
        access(32'h0000_0240, 0);                         // index 36, tag 0
        access(32'h0000_0240, 1);
        access(32'h0000_0010, 0);
        do_reset;
        chk(dut.u_valid.valid === 64'd0, "valid bits not cleared by reset");
        chk_eq(s_req, 0, "stat_requests after reset");
        chk_eq(s_hit, 0, "stat_hits after reset");
        chk_eq(s_miss, 0, "stat_misses after reset");
        chk(dut.u_tag.mem[36] === 22'd0, "(stale tag should still match)");
        peek_idx = 36; #1;
        chk(peek_line !== 128'd0, "(stale data should still be present)");
        access(32'h0000_0240, 0);                         // same address: stale tag matches, valid=0 -> miss
        // reset in the middle of a miss
        do_reset;
        start_req(32'h0000_0800);                         // index 0, tag 2; now busy refilling
        repeat (3) @(negedge clk);
        rst_n = 0; repeat (2) @(negedge clk); rst_n = 1;
        repeat (3 * LAT + 30) @(negedge clk);             // let any stray memory response arrive
        chk(req_ready === 1'b1, "controller not idle after mid-miss reset");
        chk(dut.u_valid.valid[0] === 1'b0, "aborted refill must not set valid");
        access(32'h0000_0800, 0);
        access(32'h0000_0800, 1);
        end_test;
        end

        // ---- T8 memory latency
        if (sel == 0 || sel == 8) begin
        begin_test(8, "memory_latency", "miss takes LAT+7 cycles (waits for memory), memory-wait = LAT+4, hit takes 2");
        r0 = s_wait;
        access(32'h0000_1000, 0);
        chk_eq(lat, MISS_LAT, "miss latency");
        chk_eq(s_wait - r0, WAIT_PER_MISS, "memory wait cycles for one miss");
        access(32'h0000_1000, 1);
        chk_eq(lat, 2, "hit latency");
        chk_eq(MISS_LAT - HIT_LAT, LAT + 5 + ACCEPT_DELAY, "miss penalty = LAT+5+ACCEPT_DELAY");
        $display("      measured: hit=%0d cycles, miss=%0d cycles, penalty=%0d", HIT_LAT, MISS_LAT, MISS_LAT - HIT_LAT);
        end_test;
        end

        // ---- T9 handshake
        if (sel == 0 || sel == 9) begin
        begin_test(9, "request_handshake", "requests held while busy are accepted once each, in order; withdrawn requests never accepted");
        for (k = 0; k < 40; k = k + 1) begin
            // consecutive requests hit different lines; some conflict (+1024), some reuse blocks
            stream[k] = (((k * 7) % 13) * 16 + ((k % 5 == 0) ? 1024 : 0) + (k % 4) * 4);
        end
        n = 0;
        @(negedge clk); req_valid = 1; req_addr = stream[0];
        while (n < 40) begin
            @(posedge clk);
            if (req_valid && req_ready) begin
                n = n + 1; #1;
                if (n < 40) req_addr = stream[n]; else req_valid = 0;   // next request presented while busy
            end
        end
        repeat (LAT + 20) @(negedge clk);
        chk_eq(m_req, 40, "accepted requests");
        chk_eq(m_done, 40, "responses (no drops/duplicates)");
        chk(stall_cycles > 0, "no stall seen (handshake not exercised)");
        for (k = 0; k < 40; k = k + 1) access_any(stream[k]);   // read back: cache contents must still be right
        // withdrawn request while busy + address change after accept
        r0 = m_req;
        start_req(32'h0000_2000);                         // miss
        req_addr = 32'h0000_2468;                         // CPU changes the address after accept
        @(negedge clk); req_valid = 1; req_addr = 32'h0000_3000;   // new request while busy ...
        chk(req_ready === 1'b0, "req_ready must be low while busy");
        repeat (2) @(negedge clk);
        req_valid = 0;                                    // ... withdrawn before the controller is ready
        wait_resp;
        tref_addr = 32'h0000_2000; #1;
        chk_eq(got, tref_data, "data of accepted request (not the later addr)");
        repeat (LAT + 15) @(negedge clk);
        chk_eq(m_req - r0, 1, "withdrawn request must not be accepted");
        chk_eq(m_done, m_req, "exactly one response per accepted request");
        access_any(32'h0000_2000);
        chk(got_hit === 1'b1, "accepted miss must have been installed");
        end_test;
        end

        // ---- T10 randomized
        if (sel == 0 && !$test$plusargs("fulldump")) $dumpoff;                     // full run: keep the waveform small (T1-T9 are the evidence)
        if (sel == 0 || sel == 10) begin
        begin_test(10, "randomized", "NRAND reproducible random reads (local/wide/conflict mix, idle gaps, rare resets) all match the models");
        for (n = 0; n < NRAND; n = n + 1) begin
            rnd = $random(seed); kind = (rnd >> 28) & 3;
            case (kind)
                0, 1: begin rnd = $random(seed); a = ((rnd & 32'h7FFFFFFF) % 2048) & ~3; end
                2:    begin rnd = $random(seed); a = ((rnd & 32'h7FFFFFFF) % MEM_BYTES) & ~3; end
                3:    begin rnd = $random(seed); a = ((rnd & 7) * 1024 + ((rnd >> 4) & 3) * 16 + ((rnd >> 8) & 3) * 4); end
            endcase
            rnd = $random(seed);
            if ((rnd & 32'h7FFFFFFF) % 100 == 0) a = a | 32'd1;            // ~1% misaligned
            gap = (rnd >> 8) & 3;
            if ((rnd & 32'h7FFFFFFF) % 700 == 1) do_reset;                // rare reset
            repeat (gap) @(negedge clk);
            access_any(a);
        end
        $display("      random mix: hits=%0d misses=%0d bad=%0d", m_hit, m_miss, m_bad);
        chk(m_hit > 0 && m_miss > 0 && m_bad > 0, "random mix did not cover hit/miss/error");
        end_test;
        end

        // ---- T11 boundary and error cases
        if (sel == 0 || sel == 11) begin
        begin_test(11, "boundary_and_errors", "first/last valid word OK; misaligned, out-of-range, write requests -> resp_err, no memory read");
        access(32'h0000_0000, 0);
        access(32'h0000_FFFC, 0);                           // last valid word
        access(32'h0000_FFF0, 1);                           // same (last) block
        access(32'h0000_FFC0, 0);
        r0 = mem_reqs;
        access_err(32'h0000_0001, 0);
        access_err(32'h0000_0002, 0);
        access_err(32'h0000_0003, 0);
        access_err(32'h0001_0000, 0);                       // first address past the end
        access_err(32'hFFFF_FFFC, 0);
        access_err(32'h0000_0000, 1);                       // write (not supported in milestone 1)
        chk_eq(mem_reqs - r0, 0, "error requests must not reach memory");
        chk_eq(m_bad, 6, "error requests counted");
        access(32'h0000_0000, 1);                           // still cached
        end_test;
        end

        // ---- T12 conflict example from the project brief: 100, 1124, 100, 104
        if (sel == 0 || sel == 12) begin
        begin_test(12, "conflict_100_1124_104", "100 -> 1124 -> 100: MISS MISS MISS (same line, tags 0/1); then 100 -> 104: MISS HIT (same block)");
        chk(((100 >> 4) & 63) == 6 && (100 >> 10) == 0 && (100 >> 4) == 6, "100: block 6, index 6, tag 0");
        chk(((1124 >> 4) & 63) == 6 && (1124 >> 10) == 1 && (1124 >> 4) == 70, "1124: block 70, index 6, tag 1");
        r0 = mem_reqs;
        access(100, 0);   chk(dut.u_tag.mem[6] === 22'd0 && dut.u_valid.valid[6] === 1'b1, "line 6 holds tag 0, valid");
        access(1124, 0);  chk(dut.u_tag.mem[6] === 22'd1 && dut.u_valid.valid[6] === 1'b1, "line 6 replaced: tag 1, valid");
        access(100, 0);   chk(dut.u_tag.mem[6] === 22'd0, "line 6 replaced back: tag 0");
        chk_eq(mem_reqs - r0, 3, "three misses = three block reads");
        access(104, 1);                                   // 104 is in the same 16-byte block as 100 (block 6)
        chk_eq(mem_reqs - r0, 3, "hit must not read memory");
        get_block(32'd96, blk); peek_idx = 6; #1;
        chk(peek_line === blk, "line 6 data equals main-memory block 6");
        end_test;
        end

        // ---- summary
        $display("");
        $display("==================== SUMMARY (LAT=%0d, SEED=%0d) ====================", LAT, SEED);
        for (i = 1; i <= 12; i = i + 1)
            if (sel == 0 || sel == i)
                $display("  T%0d %0s : %0s", i, res_name[i], res_pass[i] ? "PASS" : "FAIL");
        if (n_failed == 0 && n_tests == (sel == 0 ? 12 : 1)) begin
            $display("SUMMARY: PASS (%0d/%0d tests)", n_tests - n_failed, n_tests);
            $finish;
        end else begin
            $display("SUMMARY: FAIL (%0d of %0d tests failed)", n_failed, n_tests);
            $fatal(1, "testbench failed");
        end
    end

    // watchdog
    initial begin
        #400_000_000;
        $display("SUMMARY: FAIL (watchdog timeout)");
        $fatal(1, "timeout");
    end
endmodule

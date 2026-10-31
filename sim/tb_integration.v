// Phase 4 integration test: controller + memory interface + memory model,
// checked against reference_memory. A small fixed sequence; the full
// 11-test suite is tb_cache_controller.v (Phase 5).
`timescale 1ns/1ps
module tb_integration;
    parameter LAT = 4;
    reg clk = 0, rst_n = 0;
    always #5 clk = ~clk;
    reg [31:0] cyc = 0;  always @(posedge clk) cyc <= cyc + 1;

    reg         req_valid = 0, req_we = 0;
    reg  [31:0] req_addr = 0;
    wire        req_ready, resp_valid, resp_err, resp_hit;
    wire [31:0] resp_rdata;
    wire        mreq_v, mreq_r, mresp_v;
    wire [31:0] mreq_a;
    wire [127:0] mresp_d;
    wire [31:0] s_req, s_hit, s_miss, s_mrd, s_cmp, s_cyc, s_wait;

    cache_controller dut (.clk(clk), .rst_n(rst_n),
        .req_valid(req_valid), .req_ready(req_ready), .req_addr(req_addr),
        .req_we(req_we), .req_wdata(32'd0), .req_be(4'd0),
        .resp_valid(resp_valid), .resp_rdata(resp_rdata), .resp_err(resp_err), .resp_hit(resp_hit),
        .mem_req_valid(mreq_v), .mem_req_ready(mreq_r), .mem_req_addr(mreq_a),
        .mem_resp_valid(mresp_v), .mem_resp_data(mresp_d),
        .stat_requests(s_req), .stat_hits(s_hit), .stat_misses(s_miss),
        .stat_mem_reads(s_mrd), .stat_completed(s_cmp), .stat_cycles(s_cyc),
        .stat_mem_wait_cycles(s_wait));

    main_memory_model #(.LATENCY(LAT)) mem (.clk(clk), .rst_n(rst_n),
        .mem_req_valid(mreq_v), .mem_req_ready(mreq_r), .mem_req_addr(mreq_a),
        .mem_resp_valid(mresp_v), .mem_resp_data(mresp_d));

    wire [31:0] ref_data; reg [31:0] ref_addr = 0;
    reference_memory refm (.addr(ref_addr), .rdata(ref_data));

    integer errors = 0, resp_count = 0;
    always @(posedge clk) if (resp_valid) resp_count <= resp_count + 1;

    // One blocking read. Returns latency = edges from accept edge to the edge
    // where resp_valid is sampled.
    reg [31:0] got; reg got_hit, got_err; integer lat, acc;
    task do_read(input [31:0] a);
        begin
            @(negedge clk); req_valid = 1; req_addr = a;
            @(posedge clk); while (!req_ready) @(posedge clk);
            acc = cyc;                       // accept edge
            #1 req_valid = 0;
            @(posedge clk); while (!resp_valid) @(posedge clk);
            got = resp_rdata; got_hit = resp_hit; got_err = resp_err; lat = cyc - acc;
        end
    endtask

    task check(input [31:0] a, input exp_hit);
        begin
            do_read(a); ref_addr = a; #1;
            if (got_err || got !== ref_data || got_hit !== exp_hit) begin
                errors = errors + 1;
                $display("FAIL addr=%h data=%h exp=%h hit=%b exp_hit=%b err=%b", a, got, ref_data, got_hit, exp_hit, got_err);
            end else
                $display("ok   addr=%h data=%h %s lat=%0d", a, got, got_hit ? "HIT " : "MISS", lat);
        end
    endtask
    task check_err(input [31:0] a);
        begin
            do_read(a);
            if (!got_err || got !== 0) begin errors = errors + 1; $display("FAIL addr=%h expected error", a); end
            else $display("ok   addr=%h ERR (as expected) lat=%0d", a, lat);
        end
    endtask

    initial begin
        $dumpfile($sformatf("results/waveforms/phase4_lat%0d.vcd", LAT));
        $dumpvars(0, tb_integration);
        repeat (3) @(negedge clk); rst_n = 1;
        $display("--- LATENCY=%0d ---", LAT);
        check(32'h0000, 0);   // cold miss
        check(32'h0000, 1);   // repeat -> hit
        check(32'h0004, 1);   // same block, other words
        check(32'h0008, 1);
        check(32'h000C, 1);
        check(32'h0400, 0);   // conflict: same index as 0, different tag
        check(32'h0000, 0);   // evicted -> conflict miss
        check(32'h0400, 0);
        check(32'h0010, 0);   // different line
        check(32'h0400, 1);   // not evicted by the other line
        check(32'h0010, 1);
        check_err(32'h0002);  // misaligned
        check_err(32'h10000); // out of range
        repeat (3) @(negedge clk);
        $display("stats: req=%0d hit=%0d miss=%0d memrd=%0d done=%0d cycles=%0d memwait=%0d",
                 s_req, s_hit, s_miss, s_mrd, s_cmp, s_cyc, s_wait);
        if (s_req !== 13 || s_hit !== 6 || s_miss !== 5 || s_mrd !== 5 || s_cmp !== 13 || resp_count !== 13) begin
            errors = errors + 1; $display("FAIL stats mismatch");
        end
        if (errors == 0) $display("tb_integration LAT=%0d: PASS", LAT);
        else begin $display("tb_integration LAT=%0d: FAIL (%0d errors)", LAT, errors); $fatal(1); end
        $finish;
    end
endmodule

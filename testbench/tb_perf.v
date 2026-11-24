// Performance testbench: replays an address trace through the cache with
// back-to-back requests (a new request is always presented while the cache
// is busy), checks every returned word against reference_memory, and prints
// one machine-readable "PERF" line for scripts/analyze_results.py.
//
// Plusargs: +trace=<hex file, one 32-bit byte address per line> +n=<count> +name=<workload>
// Parameter: LAT = memory latency.
//
// Timing convention (identical to the functional testbench):
//   request latency = clock edges from the accept edge to the edge where
//   resp_valid is sampled. Hit = 2. Miss = LAT + 7.
`timescale 1ns/1ps
module tb_perf;
    parameter LAT = 4;
    localparam MEM_BYTES = 65536;

    reg clk = 0, rst_n = 0;
    always #5 clk = ~clk;
    reg [31:0] cyc = 0;  always @(posedge clk) cyc <= cyc + 1;

    reg         req_valid = 0;
    reg  [31:0] req_addr  = 0;
    wire        req_ready, resp_valid, resp_err, resp_hit;
    wire [31:0] resp_rdata;
    wire        mreq_v, mreq_r, mresp_v;
    wire [31:0] mreq_a;
    wire [127:0] mresp_d;
    wire [31:0] s_req, s_hit, s_miss, s_mrd, s_cmp, s_cyc, s_wait;

    cache_controller #(.MEM_BYTES(MEM_BYTES)) dut (.clk(clk), .rst_n(rst_n),
        .req_valid(req_valid), .req_ready(req_ready), .req_addr(req_addr),
        .req_we(1'b0), .req_wdata(32'd0), .req_be(4'd0),
        .resp_valid(resp_valid), .resp_rdata(resp_rdata), .resp_err(resp_err), .resp_hit(resp_hit),
        .mem_req_valid(mreq_v), .mem_req_ready(mreq_r), .mem_req_addr(mreq_a),
        .mem_resp_valid(mresp_v), .mem_resp_data(mresp_d),
        .stat_requests(s_req), .stat_hits(s_hit), .stat_misses(s_miss),
        .stat_mem_reads(s_mrd), .stat_completed(s_cmp), .stat_cycles(s_cyc),
        .stat_mem_wait_cycles(s_wait));

    main_memory_model #(.MEM_BYTES(MEM_BYTES), .LATENCY(LAT)) mem (.clk(clk), .rst_n(rst_n),
        .mem_req_valid(mreq_v), .mem_req_ready(mreq_r), .mem_req_addr(mreq_a),
        .mem_resp_valid(mresp_v), .mem_resp_data(mresp_d));

    reg  [31:0] ref_addr = 0;  wire [31:0] ref_data;
    reference_memory #(.MEM_BYTES(MEM_BYTES)) refm (.addr(ref_addr), .rdata(ref_data));

    reg [31:0] trace [0:65535];
    integer n = 0;
    reg [8*256-1:0] fname, wname;

    // measurement
    integer acc_cyc = 0, started = 0, finished = 0, data_errors = 0;
    integer seen_hits = 0, seen_misses = 0, hit_lat_sum = 0, miss_lat_sum = 0;
    integer lat;

    always @(posedge clk) if (rst_n) begin
        if (resp_valid) begin
            lat = cyc - acc_cyc;
            if (resp_err || resp_rdata !== ref_data) begin
                data_errors = data_errors + 1;
                $display("DATA ERROR addr=%h got=%h exp=%h err=%b", ref_addr, resp_rdata, ref_data, resp_err);
            end
            if (resp_hit) begin seen_hits = seen_hits + 1; hit_lat_sum = hit_lat_sum + lat; end
            else          begin seen_misses = seen_misses + 1; miss_lat_sum = miss_lat_sum + lat; end
            finished = finished + 1;
        end
        if (req_valid && req_ready) begin acc_cyc = cyc; ref_addr = req_addr; started = started + 1; end
    end

    integer k;
    initial begin
        if (!$value$plusargs("trace=%s", fname)) begin $display("missing +trace"); $fatal(1); end
        if (!$value$plusargs("n=%d", n))          begin $display("missing +n");     $fatal(1); end
        if (!$value$plusargs("name=%s", wname))   wname = "unnamed";
        $readmemh(fname, trace);

        repeat (3) @(negedge clk); rst_n = 1; @(negedge clk);

        k = 0;
        req_valid = 1; req_addr = trace[0];
        while (k < n) begin
            @(posedge clk);
            if (req_valid && req_ready) begin
                k = k + 1; #1;
                if (k < n) req_addr = trace[k]; else req_valid = 0;
            end
        end
        while (finished < n) @(posedge clk);
        repeat (3) @(negedge clk);

        $display("PERF workload=%0s lat=%0d n=%0d hits=%0d misses=%0d mem_reads=%0d completed=%0d cycles=%0d mem_wait=%0d hit_lat_sum=%0d miss_lat_sum=%0d data_errors=%0d",
                 wname, LAT, n, s_hit, s_miss, s_mrd, s_cmp, s_cyc, s_wait, hit_lat_sum, miss_lat_sum, data_errors);
        // internal consistency: DUT counters must agree with what the testbench observed
        if (data_errors != 0 || s_req !== n || s_cmp !== n || s_hit !== seen_hits || s_miss !== seen_misses ||
            s_mrd !== s_miss || s_hit + s_miss !== n) begin
            $display("PERF_FAIL counters/data inconsistent"); $fatal(1);
        end
        $display("PERF_OK");
        $finish;
    end

    initial begin #2_000_000_000; $display("PERF_FAIL timeout"); $fatal(1); end
endmodule

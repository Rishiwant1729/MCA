// Direct-mapped cache controller (milestone 1: read-only, blocking).
//
// FSM:  IDLE -> LOOKUP -> COMPLETE -> IDLE                         (hit)
//       IDLE -> LOOKUP -> MISS_REQ -> WAIT_MEM -> REFILL -> COMPLETE -> IDLE (miss)
//       IDLE -> COMPLETE -> IDLE                                   (bad request)
//
// CPU handshake: a request is accepted on the clock edge where
// req_valid && req_ready. req_ready is high only in IDLE. Exactly one
// resp_valid pulse follows each accepted request.
//
// Bad request (resp_err=1, rdata=0, not counted as hit or miss): misaligned
// word address, address >= MEM_BYTES, or req_we=1 (writes are milestone 2).
module cache_controller #(
    parameter ADDR_WIDTH  = 32,
    parameter CACHE_BYTES = 1024,
    parameter BLOCK_BYTES = 16,
    parameter MEM_BYTES   = 65536,     // valid address range: [0, MEM_BYTES)
    // derived (do not override)
    parameter NUM_LINES   = CACHE_BYTES / BLOCK_BYTES,
    parameter OFFSET_W    = $clog2(BLOCK_BYTES),
    parameter INDEX_W     = $clog2(NUM_LINES),
    parameter TAG_W       = ADDR_WIDTH - INDEX_W - OFFSET_W,
    parameter BLOCK_BITS  = BLOCK_BYTES * 8
) (
    input  wire                  clk,
    input  wire                  rst_n,
    // processor side
    input  wire                  req_valid,
    output wire                  req_ready,
    input  wire [ADDR_WIDTH-1:0] req_addr,
    input  wire                  req_we,
    input  wire [31:0]           req_wdata,
    input  wire [3:0]            req_be,
    output wire                  resp_valid,
    output wire [31:0]           resp_rdata,
    output wire                  resp_err,
    output wire                  resp_hit,
    // memory side
    output wire                  mem_req_valid,
    input  wire                  mem_req_ready,
    output wire [ADDR_WIDTH-1:0] mem_req_addr,
    input  wire                  mem_resp_valid,
    input  wire [BLOCK_BITS-1:0] mem_resp_data,
    // statistics (cleared by reset)
    output reg  [31:0]           stat_requests,
    output reg  [31:0]           stat_hits,
    output reg  [31:0]           stat_misses,
    output reg  [31:0]           stat_mem_reads,
    output reg  [31:0]           stat_completed,
    output reg  [31:0]           stat_cycles,
    output reg  [31:0]           stat_mem_wait_cycles
);
    localparam [2:0] S_IDLE = 3'd0, S_LOOKUP = 3'd1, S_MISS_REQ = 3'd2,
                     S_WAIT_MEM = 3'd3, S_REFILL = 3'd4, S_COMPLETE = 3'd5;

    reg [2:0]            state, next_state;
    reg [ADDR_WIDTH-1:0] addr_q;       // latched request address
    reg                  err_q;
    reg                  hit_q;

    // ---------------- request acceptance ----------------
    assign req_ready = (state == S_IDLE);
    wire accept  = req_valid && req_ready;
    wire req_bad = (req_addr[1:0] != 2'b00) || (req_addr >= MEM_BYTES) || req_we;

    // ---------------- address decode (live and latched) ----------------
    wire [TAG_W-1:0]   live_tag;   wire [INDEX_W-1:0] live_index;
    wire [OFFSET_W-1:0] live_off;  wire [ADDR_WIDTH-1:0] live_blk;
    address_decoder #(.ADDR_WIDTH(ADDR_WIDTH), .CACHE_BYTES(CACHE_BYTES), .BLOCK_BYTES(BLOCK_BYTES))
        u_dec_live (.addr(req_addr), .tag(live_tag), .index(live_index),
                    .offset(live_off), .block_addr(live_blk));

    wire [TAG_W-1:0]   q_tag;      wire [INDEX_W-1:0] q_index;
    wire [OFFSET_W-1:0] q_off;     wire [ADDR_WIDTH-1:0] q_blk;
    address_decoder #(.ADDR_WIDTH(ADDR_WIDTH), .CACHE_BYTES(CACHE_BYTES), .BLOCK_BYTES(BLOCK_BYTES))
        u_dec_q (.addr(addr_q), .tag(q_tag), .index(q_index),
                 .offset(q_off), .block_addr(q_blk));

    // ---------------- storage ----------------
    wire [BLOCK_BITS-1:0] rd_block;
    wire [TAG_W-1:0]      rd_tag;
    wire                  rd_valid;
    wire [BLOCK_BITS-1:0] refill_block;
    wire                  refill_en = (state == S_REFILL);

    // Read all three arrays at the accept edge; results are ready in LOOKUP.
    cache_data_ram #(.NUM_LINES(NUM_LINES), .BLOCK_BYTES(BLOCK_BYTES)) u_data (
        .clk(clk), .rd_en(accept), .rd_index(live_index), .rd_data(rd_block),
        .wr_en(refill_en), .wr_index(q_index), .wr_data(refill_block),
        .wr_mask({BLOCK_BYTES{1'b1}}));

    cache_tag_ram #(.NUM_LINES(NUM_LINES), .TAG_W(TAG_W)) u_tag (
        .clk(clk), .rd_en(accept), .rd_index(live_index), .rd_tag(rd_tag),
        .wr_en(refill_en), .wr_index(q_index), .wr_tag(q_tag));

    cache_valid_ram #(.NUM_LINES(NUM_LINES)) u_valid (
        .clk(clk), .rst_n(rst_n), .rd_en(accept), .rd_index(live_index), .rd_valid(rd_valid),
        .wr_en(refill_en), .wr_index(q_index), .wr_valid(1'b1));

    // ---------------- hit / miss ----------------
    // tag_comparator: stored tag == request tag.  hit_miss_unit: hit = valid && tag match,
    // so an invalid line is always a miss, whatever tag it holds.
    wire tag_match, hit, miss;
    tag_comparator #(.TAG_W(TAG_W)) u_cmp (.stored_tag(rd_tag), .request_tag(q_tag), .match(tag_match));
    hit_miss_unit u_hm (.valid(rd_valid), .tag_match(tag_match), .hit(hit), .miss(miss));

    // ---------------- memory side ----------------
    wire mem_done;
    wire mem_start = (state == S_MISS_REQ);

    main_memory_interface #(.ADDR_WIDTH(ADDR_WIDTH), .BLOCK_BYTES(BLOCK_BYTES)) u_mem (
        .clk(clk), .rst_n(rst_n), .start(mem_start), .blk_addr(q_blk),
        .done(mem_done), .blk_data(refill_block),
        .mem_req_valid(mem_req_valid), .mem_req_ready(mem_req_ready),
        .mem_req_addr(mem_req_addr), .mem_resp_valid(mem_resp_valid),
        .mem_resp_data(mem_resp_data));

    // ---------------- FSM ----------------
    always @(*) begin
        next_state = state;
        case (state)
            S_IDLE:     if (accept) next_state = req_bad ? S_COMPLETE : S_LOOKUP;
            S_LOOKUP:   next_state = hit ? S_COMPLETE : S_MISS_REQ;
            S_MISS_REQ: next_state = S_WAIT_MEM;
            S_WAIT_MEM: if (mem_done) next_state = S_REFILL;
            S_REFILL:   next_state = S_COMPLETE;
            S_COMPLETE: next_state = S_IDLE;
            default:    next_state = S_IDLE;
        endcase
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            state  <= S_IDLE;
            addr_q <= {ADDR_WIDTH{1'b0}};
            err_q  <= 1'b0;
            hit_q  <= 1'b0;
        end else begin
            state <= next_state;
            if (accept) begin
                addr_q <= req_addr;
                err_q  <= req_bad;
                hit_q  <= 1'b0;
            end
            if (state == S_LOOKUP) hit_q <= hit;
        end
    end

    // ---------------- response ----------------
    // Hit: word comes from the data RAM read register (held since accept).
    // Miss: word comes straight from the refilled block register.
    wire [BLOCK_BITS-1:0] src_block = hit_q ? rd_block : refill_block;
    wire [OFFSET_W-3:0]   word_sel  = q_off[OFFSET_W-1:2];

    assign resp_valid = (state == S_COMPLETE);
    assign resp_err   = resp_valid && err_q;
    assign resp_hit   = resp_valid && hit_q && !err_q;
    assign resp_rdata = (resp_valid && !err_q) ? src_block[32*word_sel +: 32] : 32'd0;

    // ---------------- statistics ----------------
    always @(posedge clk) begin
        if (!rst_n) begin
            stat_requests <= 0; stat_hits <= 0; stat_misses <= 0;
            stat_mem_reads <= 0; stat_completed <= 0;
            stat_cycles <= 0; stat_mem_wait_cycles <= 0;
        end else begin
            stat_cycles <= stat_cycles + 1;
            if (accept)                  stat_requests  <= stat_requests + 1;
            if (state == S_LOOKUP && hit)  stat_hits   <= stat_hits + 1;
            if (state == S_LOOKUP && miss) stat_misses <= stat_misses + 1;
            if (mem_start)               stat_mem_reads <= stat_mem_reads + 1;
            if (resp_valid)              stat_completed <= stat_completed + 1;
            // memory-wait: every cycle from MISS_REQ until the block arrives
            if (state == S_MISS_REQ || state == S_WAIT_MEM)
                stat_mem_wait_cycles <= stat_mem_wait_cycles + 1;
        end
    end
endmodule

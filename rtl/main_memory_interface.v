// Memory-side protocol engine. The cache controller never sees raw memory
// signals; it just says "start a block read at this address" and waits for done.
//
//   controller side: start (1-cycle pulse), blk_addr, done (1-cycle pulse), blk_data
//   memory side    : mem_req_valid/ready/addr, mem_resp_valid/data
//
// mem_req_valid is held until mem_req_ready, so a busy memory cannot lose the
// request. blk_data stays stable after done until the next start.
module main_memory_interface #(
    parameter ADDR_WIDTH  = 32,
    parameter BLOCK_BYTES = 16
) (
    input  wire                       clk,
    input  wire                       rst_n,
    // controller side
    input  wire                       start,
    input  wire [ADDR_WIDTH-1:0]      blk_addr,
    output reg                        done,
    output reg  [BLOCK_BYTES*8-1:0]   blk_data,
    // memory side
    output wire                       mem_req_valid,
    input  wire                       mem_req_ready,
    output wire [ADDR_WIDTH-1:0]      mem_req_addr,
    input  wire                       mem_resp_valid,
    input  wire [BLOCK_BYTES*8-1:0]   mem_resp_data
);
    localparam [1:0] M_IDLE = 2'd0, M_REQ = 2'd1, M_WAIT = 2'd2;
    reg [1:0]            mstate;
    reg [ADDR_WIDTH-1:0] addr_q;

    assign mem_req_valid = (mstate == M_REQ);
    assign mem_req_addr  = addr_q;

    always @(posedge clk) begin
        if (!rst_n) begin
            mstate   <= M_IDLE;
            addr_q   <= {ADDR_WIDTH{1'b0}};
            done     <= 1'b0;
            blk_data <= {BLOCK_BYTES*8{1'b0}};
        end else begin
            done <= 1'b0;
            case (mstate)
                M_IDLE: if (start) begin
                    addr_q <= blk_addr;
                    mstate <= M_REQ;
                end
                M_REQ:  if (mem_req_ready) mstate <= M_WAIT;
                M_WAIT: if (mem_resp_valid) begin
                    blk_data <= mem_resp_data;
                    done     <= 1'b1;
                    mstate   <= M_IDLE;
                end
                default: mstate <= M_IDLE;
            endcase
        end
    end
endmodule

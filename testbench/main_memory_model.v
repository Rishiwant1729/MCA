// Behavioral main memory (simulation only). Block-read interface with a
// configurable latency. Replaceable by any module with the same ports.
//
//   req:  mem_req_valid & mem_req_ready  -> request accepted on that clock edge
//   ACCEPT_DELAY (default 0): extra cycles mem_req_ready stays low after mem_req_valid rises while the
//                 memory is idle, to exercise back-pressure. 0 = accept as soon as idle (original behaviour).
//   resp: mem_resp_valid is a 1-cycle pulse, LATENCY clock edges after accept
//         (LATENCY >= 1). While busy, mem_req_ready is 0.
// Block bytes: byte i of the block is at mem_resp_data[8*i +: 8].
// Out-of-range block reads return zeros and print a warning.
module main_memory_model #(
    parameter ADDR_WIDTH  = 32,
    parameter BLOCK_BYTES = 16,
    parameter MEM_BYTES   = 65536,
    parameter LATENCY     = 4,
    parameter ACCEPT_DELAY = 0
) (
    input  wire                       clk,
    input  wire                       rst_n,
    input  wire                       mem_req_valid,
    output wire                       mem_req_ready,
    input  wire [ADDR_WIDTH-1:0]      mem_req_addr,
    output reg                        mem_resp_valid,
    output reg  [BLOCK_BYTES*8-1:0]   mem_resp_data
);
    `include "mem_init.vh"

    reg [7:0] mem [0:MEM_BYTES-1];
    integer i, k;
    initial for (i = 0; i < MEM_BYTES; i = i + 1) mem[i] = init_byte(i);

    reg                  busy;
    integer              cnt;
    reg [ADDR_WIDTH-1:0] addr_q;
    integer              wait_cnt;
    assign mem_req_ready = !busy && (wait_cnt >= ACCEPT_DELAY);

    always @(posedge clk) begin
        mem_resp_valid <= 1'b0;
        if (!rst_n) begin
            busy <= 1'b0; cnt <= 0; wait_cnt <= 0;
        end else if (mem_req_valid && mem_req_ready) begin
            busy <= 1'b1; cnt <= LATENCY; addr_q <= mem_req_addr; wait_cnt <= 0;
        end else if (!busy && mem_req_valid) begin
            wait_cnt <= wait_cnt + 1;                     // request pending, not yet accepted
        end else if (busy) begin
            if (cnt <= 1) begin
                busy <= 1'b0;
                mem_resp_valid <= 1'b1;
                if (addr_q + BLOCK_BYTES > MEM_BYTES) begin
                    $display("WARNING main_memory_model: block read out of range @%h", addr_q);
                    mem_resp_data <= {BLOCK_BYTES*8{1'b0}};
                end else
                    for (k = 0; k < BLOCK_BYTES; k = k + 1)
                        mem_resp_data[8*k +: 8] <= mem[addr_q + k];
            end else
                cnt <= cnt - 1;
        end
    end
endmodule

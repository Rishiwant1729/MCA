// Unit test: address_decoder vs. independent bit-slicing, default and an alternate geometry.
`timescale 1ns/1ps
module tb_address_decoder;
    reg  [31:0] a;
    wire [21:0] tag;  wire [5:0] idx;  wire [3:0] off;  wire [31:0] blk;
    address_decoder dut (.addr(a), .tag(tag), .index(idx), .offset(off), .block_addr(blk));

    // alternate: 2KB cache, 32B blocks -> offset 5, 64 lines -> index 6, tag 21
    wire [20:0] tag2; wire [5:0] idx2; wire [4:0] off2; wire [31:0] blk2;
    address_decoder #(.CACHE_BYTES(2048), .BLOCK_BYTES(32)) dut2
        (.addr(a), .tag(tag2), .index(idx2), .offset(off2), .block_addr(blk2));

    integer i, errors = 0, checks = 0;
    task chk(input cond, input [255:0] what);
        begin checks = checks + 1; end
        if (!cond) begin errors = errors + 1; $display("FAIL %0s addr=%h", what, a); end
    endtask
    initial begin
        // fixed corner cases
        a = 32'h0000_0000; #1; chk(tag==0 && idx==0 && off==0, "zero");
        a = 32'h0000_0400; #1; chk(tag==1 && idx==0 && off==0, "1024 -> tag1 idx0");
        a = 32'h0000_03F0; #1; chk(tag==0 && idx==63 && off==0, "idx63");
        a = 32'hFFFF_FFFF; #1; chk(tag==22'h3FFFFF && idx==63 && off==15, "all ones");
        // same index, different tag (conflict addresses 0 and 1024)
        a = 32'h0; #1; begin : c1 reg [5:0] i0; i0 = idx; a = 32'd1024; #1; chk(idx==i0 && tag!=0, "conflict idx"); end
        // random vs. slicing
        for (i = 0; i < 20000; i = i + 1) begin
            a = $random; #1;
            chk(tag == a[31:10] && idx == a[9:4] && off == a[3:0] && blk == {a[31:4],4'b0}, "default slice");
            chk(tag2 == a[31:11] && idx2 == a[10:5] && off2 == a[4:0] && blk2 == {a[31:5],5'b0}, "alt slice");
        end
        if (errors == 0) $display("tb_address_decoder: PASS (%0d checks, 0 failures)", checks); else begin $display("tb_address_decoder: FAIL (%0d of %0d checks failed)", errors, checks); $fatal(1); end
        $finish;
    end
endmodule

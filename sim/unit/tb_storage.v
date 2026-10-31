// Unit test: data RAM, tag RAM, valid RAM.
`timescale 1ns/1ps
module tb_storage;
    reg clk = 0, rst_n = 0;
    always #5 clk = ~clk;

    reg d_rd=0; reg [5:0] d_ri=0; wire [127:0] d_q;
    reg d_wr=0; reg [5:0] d_wi=0; reg [127:0] d_wd=0; reg [15:0] d_wm=0;
    cache_data_ram dd (.clk(clk), .rd_en(d_rd), .rd_index(d_ri), .rd_data(d_q),
                       .wr_en(d_wr), .wr_index(d_wi), .wr_data(d_wd), .wr_mask(d_wm));

    reg t_rd=0; reg [5:0] t_ri=0; wire [21:0] t_q;
    reg t_wr=0; reg [5:0] t_wi=0; reg [21:0] t_wt=0;
    cache_tag_ram tt (.clk(clk), .rd_en(t_rd), .rd_index(t_ri), .rd_tag(t_q),
                      .wr_en(t_wr), .wr_index(t_wi), .wr_tag(t_wt));

    reg v_rd=0; reg [5:0] v_ri=0; wire v_q;
    reg v_wr=0; reg [5:0] v_wi=0; reg v_wv=0;
    cache_valid_ram vv (.clk(clk), .rst_n(rst_n), .rd_en(v_rd), .rd_index(v_ri), .rd_valid(v_q),
                        .wr_en(v_wr), .wr_index(v_wi), .wr_valid(v_wv));

    integer errors = 0, i;
    task chk(input cond, input [255:0] what);
        if (!cond) begin errors = errors + 1; $display("FAIL %0s @%0t", what, $time); end
    endtask

    task data_write(input [5:0] i, input [127:0] d, input [15:0] m);
        begin @(negedge clk); d_wr=1; d_wi=i; d_wd=d; d_wm=m; @(negedge clk); d_wr=0; end
    endtask
    task data_read(input [5:0] i);
        begin @(negedge clk); d_rd=1; d_ri=i; @(negedge clk); d_rd=0; end   // q valid after the edge
    endtask

    initial begin
        repeat (2) @(negedge clk); rst_n = 1;

        // valid bits all 0 after reset
        for (i = 0; i < 64; i = i + 1) begin
            @(negedge clk); v_rd=1; v_ri=i; @(negedge clk); v_rd=0; chk(v_q==0, "valid=0 after reset");
        end
        // set valid[5], others stay 0
        @(negedge clk); v_wr=1; v_wi=5; v_wv=1; @(negedge clk); v_wr=0;
        @(negedge clk); v_rd=1; v_ri=5; @(negedge clk); chk(v_q==1, "valid[5]=1");
        v_ri=6; @(negedge clk); chk(v_q==0, "valid[6]=0");
        v_rd=0;
        // reset clears it again
        @(negedge clk); rst_n=0; @(negedge clk); rst_n=1;
        @(negedge clk); v_rd=1; v_ri=5; @(negedge clk); v_rd=0; chk(v_q==0, "valid cleared by reset");

        // tag RAM
        @(negedge clk); t_wr=1; t_wi=63; t_wt=22'h2A5A5A; @(negedge clk); t_wr=0;
        @(negedge clk); t_wr=1; t_wi=0;  t_wt=22'h000001; @(negedge clk); t_wr=0;
        @(negedge clk); t_rd=1; t_ri=63; @(negedge clk); chk(t_q==22'h2A5A5A, "tag[63]");
        t_ri=0; @(negedge clk); chk(t_q==22'h000001, "tag[0]");
        t_rd=0; t_ri=63; @(negedge clk); chk(t_q==22'h000001, "tag read holds when rd_en=0");

        // data RAM: full-line write, independent lines, read hold, byte mask
        data_write(3,  128'h0F0E0D0C_0B0A0908_07060504_03020100, 16'hFFFF);
        data_write(4,  128'hFFEEDDCC_BBAA9988_77665544_33221100, 16'hFFFF);
        data_read(3); chk(d_q==128'h0F0E0D0C_0B0A0908_07060504_03020100, "data line 3");
        data_read(4); chk(d_q==128'hFFEEDDCC_BBAA9988_77665544_33221100, "data line 4");
        // read hold: rd_en=0 keeps old output even if line changes
        data_write(4, 128'h0, 16'hFFFF); chk(d_q==128'hFFEEDDCC_BBAA9988_77665544_33221100, "data read holds");
        // byte mask: write only bytes 0 and 15 of line 3
        data_write(3, 128'hAA000000_00000000_00000000_000000BB, 16'h8001);
        data_read(3);
        chk(d_q==128'hAA0E0D0C_0B0A0908_07060504_030201BB, "byte mask write");

        if (errors == 0) $display("tb_storage: PASS"); else begin $display("tb_storage: FAIL (%0d errors)", errors); $fatal(1); end
        $finish;
    end
endmodule
